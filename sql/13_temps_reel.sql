-- =============================================================================
-- GAE - ERP : 13_temps_reel.sql
-- Notification des changements de donnees en temps reel.
--
-- Principe : chaque modification d'une table suivie declenche un `pg_notify`
-- sur le canal unique `gae_evenements`. L'API ecoute ce canal (voir
-- src/realtime/bus.js) et rediffuse les evenements aux navigateurs abonnes
-- via un flux SSE (src/realtime/sse.js).
--
-- Points importants pour la production :
--   * LISTEN / NOTIFY est transactionnel : l'evenement n'est delivre qu'au
--     COMMIT, donc jamais pour une transaction annulee (ROLLBACK).
--   * Le message ne contient QUE des identifiants (jamais les donnees
--     metier) : la taille reste tres en dessous de la limite PostgreSQL
--     de 8000 octets et aucun droit n'est revele par le canal lui-meme.
--     Le client revalide systematiquement ses donnees via l'API (filtrage
--     par permissions fait par le serveur).
--   * Le script est idempotent : il peut etre rejoue sans effet de bord.
--
-- A executer APRES 12_comptable_pharmacie.sql.
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Fonction generique de notification
-- Le type fonctionnel de l'evenement est passe en argument du trigger :
--   EXECUTE FUNCTION fn_notifier_temps_reel('pharmacie.ventes')
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notifier_temps_reel()
RETURNS TRIGGER AS $$
DECLARE
  ligne    JSONB;
  v_id     TEXT;
  v_point  TEXT;
  v_acteur TEXT;
  v_type   TEXT;
BEGIN
  -- La ligne concernee : NEW pour INSERT/UPDATE, OLD pour DELETE
  IF TG_OP = 'DELETE' THEN
    ligne := to_jsonb(OLD);
  ELSE
    ligne := to_jsonb(NEW);
  END IF;

  -- Identifiant de l'entite (tables de liaison sans colonne `id` incluses)
  v_id := COALESCE(
    ligne ->> 'id',
    ligne ->> 'utilisateur_id',
    ligne ->> 'role_id',
    ligne ->> 'permission_id',
    ligne ->> 'vente_id',
    ligne ->> 'commande_id',
    ligne ->> 'inventaire_id'
  );

  -- Perimetre (point de vente ou departement) : sert au filtrage cote client
  v_point := COALESCE(ligne ->> 'point_id', ligne ->> 'departement_id');

  -- Auteur de la modification, quand la table le porte
  v_acteur := COALESCE(
    ligne ->> 'vendeur_id',
    ligne ->> 'utilisateur_id',
    ligne ->> 'cree_par',
    ligne ->> 'recepteur_id',
    ligne ->> 'encaisse_par',
    ligne ->> 'ouverte_par',
    ligne ->> 'cloturee_par'
  );

  v_type := COALESCE(NULLIF(TG_ARGV[0], ''), TG_TABLE_NAME);

  PERFORM pg_notify(
    'gae_evenements',
    jsonb_build_object(
      'type',       v_type,
      'table',      TG_TABLE_NAME,
      'operation',  TG_OP,
      'entiteId',   v_id,
      'pointId',    v_point,
      'acteurId',   v_acteur,
      'horodatage', now()
    )::text
  );

  RETURN NULL;  -- trigger AFTER : la valeur retournee est ignoree
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_notifier_temps_reel() IS
  'Publie un evenement de changement (canal gae_evenements) pour la ligne modifiee.';

-- -----------------------------------------------------------------------------
-- Association table suivie -> type fonctionnel de l'evenement
-- Le nom du type correspond au prefixe ecoute par le frontend
-- (ex. « pharmacie.ventes » -> pages ventes, finance et tableaux de bord).
-- Les tables absentes sont ignorees : le script reste rejouable.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  association RECORD;
  nom_trigger TEXT;
BEGIN
  FOR association IN
    SELECT * FROM (VALUES
      -- Module IAM ----------------------------------------------------------
      ('utilisateurs',                'iam.utilisateurs'),
      ('utilisateurs_roles',          'iam.utilisateurs'),
      ('utilisateurs_departements',   'iam.utilisateurs'),
      ('roles',                       'iam.roles'),
      ('roles_permissions',           'iam.roles'),
      ('permissions',                 'iam.permissions'),
      ('departements',                'iam.departements'),
      ('journal_audit',               'iam.audit'),
      ('jetons_rafraichissement',     'iam.sessions'),
      -- Module Pharmacie ----------------------------------------------------
      ('pharmacie_points',            'pharmacie.points'),
      ('pharmacie_produits',          'pharmacie.produits'),
      ('pharmacie_produits_points',   'pharmacie.produits'),
      ('pharmacie_lots',              'pharmacie.stocks'),
      ('pharmacie_mouvements_stock',  'pharmacie.stocks'),
      ('pharmacie_fournisseurs',      'pharmacie.fournisseurs'),
      ('pharmacie_commandes',         'pharmacie.commandes'),
      ('pharmacie_commandes_lignes',  'pharmacie.commandes'),
      ('pharmacie_receptions',        'pharmacie.commandes'),
      ('pharmacie_inventaires',       'pharmacie.inventaires'),
      ('pharmacie_inventaires_lignes','pharmacie.inventaires'),
      ('pharmacie_ventes',            'pharmacie.ventes'),
      ('pharmacie_ventes_lignes',     'pharmacie.ventes'),
      ('pharmacie_paiements',         'pharmacie.finance'),
      ('pharmacie_caisses',           'pharmacie.finance'),
      ('pharmacie_clients',           'pharmacie.clients')
    ) AS t(table_cible, type_evenement)
  LOOP
    IF to_regclass(association.table_cible) IS NULL THEN
      RAISE NOTICE 'Table % absente : temps reel non configure pour elle.', association.table_cible;
      CONTINUE;
    END IF;

    nom_trigger := 'trg_temps_reel_' || left(association.table_cible, 45);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', nom_trigger, association.table_cible);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel(%L)',
      nom_trigger, association.table_cible, association.type_evenement
    );
  END LOOP;
END $$;
