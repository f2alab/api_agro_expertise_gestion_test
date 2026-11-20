-- =============================================================================
-- GAE - ERP : 60_ravitaillements_temps_reel.sql
-- Temps reel des demandes de ravitaillement du magasin central.
--
-- Les tables `pharmacie_demandes_ravitaillement` et
-- `pharmacie_demandes_ravitaillement_lignes` ne figuraient pas dans
-- 13_temps_reel.sql : une demande creee, approuvee ou rejetee par un autre
-- poste n'etait donc pas diffusee aux navigateurs.
--
-- Ce script :
--   1. etend `fn_notifier_temps_reel` pour exposer `point_destination_id`
--      comme perimetre (les demandes portent la pharmacie de destination) ;
--   2. ajoute les triggers sur les deux tables, sous le type
--      `pharmacie.ravitaillements` (autorise par `pharmacie.magasin.read`).
--
-- A executer APRES 59_ravitaillements_validation.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Fonction generique : le point de rattachement inclut la destination.
--    (Le reste du comportement est identique a 13_temps_reel.sql.)
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
  IF TG_OP = 'DELETE' THEN
    ligne := to_jsonb(OLD);
  ELSE
    ligne := to_jsonb(NEW);
  END IF;

  v_id := COALESCE(
    ligne ->> 'id',
    ligne ->> 'utilisateur_id',
    ligne ->> 'role_id',
    ligne ->> 'permission_id',
    ligne ->> 'vente_id',
    ligne ->> 'commande_id',
    ligne ->> 'inventaire_id'
  );

  -- Perimetre : point de vente, destination d'un ravitaillement ou departement.
  v_point := COALESCE(
    ligne ->> 'point_id',
    ligne ->> 'point_destination_id',
    ligne ->> 'departement_id'
  );

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

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Triggers des demandes et de leurs lignes.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  association RECORD;
  nom_trigger TEXT;
BEGIN
  FOR association IN
    SELECT * FROM (VALUES
      ('pharmacie_demandes_ravitaillement',        'pharmacie.ravitaillements'),
      ('pharmacie_demandes_ravitaillement_lignes', 'pharmacie.ravitaillements')
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