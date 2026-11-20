-- =============================================================================
-- GAE - ERP : 28_parametres.sql
-- Paramètres applicatifs administrables (clé / valeur JSONB).
--   * table `parametres` : un réglage typé, exposé par l'API et modifiable par
--     les profils autorisés (DG, DGA, Directeur Technique, Comptable) ;
--   * permissions `parametres.systeme.read` / `parametres.systeme.update` ;
--   * paramètres de gestion des retours de vente et du remboursement ;
--   * temps réel : les écrans abonnés se rafraîchissent à chaque modification.
-- A executer APRES 27_depenses_datetime.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Table : parametres
-- `type_valeur` guide l'affichage côté frontend (case à cocher, champ texte...).
-- `public` = TRUE : le paramètre est lisible par tout profil authentifié
-- (utile aux écrans métier qui doivent connaître un réglage sans y accéder).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parametres (
  cle         VARCHAR(80)  PRIMARY KEY,
  valeur      JSONB        NOT NULL,
  categorie   VARCHAR(40)  NOT NULL DEFAULT 'general',
  libelle     VARCHAR(180) NOT NULL,
  description TEXT,
  type_valeur VARCHAR(20)  NOT NULL DEFAULT 'BOOLEEN',
  public      BOOLEAN      NOT NULL DEFAULT FALSE,
  modifie_par UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_parametres_type CHECK (type_valeur IN ('BOOLEEN', 'TEXTE', 'NOMBRE', 'JSON'))
);

COMMENT ON TABLE parametres IS 'Paramètres applicatifs administrables (clé / valeur JSONB).';
COMMENT ON COLUMN parametres.public IS 'TRUE = lisible par tout profil authentifié (endpoint /parametres/publics).';

-- -----------------------------------------------------------------------------
-- Paramètres de gestion des retours de vente (activés par défaut).
-- -----------------------------------------------------------------------------
INSERT INTO parametres (cle, valeur, categorie, libelle, description, type_valeur, public) VALUES
  ('pharmacie.retours.actif', 'true'::jsonb, 'pharmacie', 'Retours de vente',
   'Autoriser les retours de produits sur une vente de la pharmacie.', 'BOOLEEN', TRUE),
  ('pharmacie.retours.remboursement.actif', 'true'::jsonb, 'pharmacie', 'Remboursement des retours',
   'Rembourser en especes le montant des produits retournes. Si desactive, seules les ventes encore a credit (reduction de la creance) peuvent etre retournees.',
   'BOOLEEN', TRUE)
ON CONFLICT (cle) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permissions (module `parametres`)
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('parametres.systeme.read',   'parametres', 'systeme', 'read',   'Consulter les parametres', 'Acceder aux parametres applicatifs de la plateforme'),
  ('parametres.systeme.update', 'parametres', 'systeme', 'update', 'Modifier les parametres',  'Activer ou desactiver les parametres applicatifs')
ON CONFLICT (code) DO NOTHING;

-- Attribution : Direction (DG, DGA), Directeur Technique et Comptable.
-- SUPER_ADMIN est ajoute explicitement (le seed initial ne connaissait pas ces codes).
WITH attributions (role_code, permissions) AS (VALUES
  ('SUPER_ADMIN',   ARRAY['parametres.systeme.read', 'parametres.systeme.update']),
  ('DG',            ARRAY['parametres.systeme.read', 'parametres.systeme.update']),
  ('DGA',           ARRAY['parametres.systeme.read', 'parametres.systeme.update']),
  ('DIR_TECHNIQUE', ARRAY['parametres.systeme.read', 'parametres.systeme.update']),
  ('COMPTABLE',     ARRAY['parametres.systeme.read', 'parametres.systeme.update'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = ANY (a.permissions)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Temps réel : chaque modification d'un paramètre notifie les écrans abonnés.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('parametres') IS NOT NULL AND to_regprocedure('fn_notifier_temps_reel()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_temps_reel_parametres ON parametres;
    CREATE TRIGGER trg_temps_reel_parametres
      AFTER INSERT OR UPDATE OR DELETE ON parametres
      FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel('parametres.systeme');
  END IF;
END $$;