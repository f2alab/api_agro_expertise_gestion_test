-- =============================================================================
-- GAE - ERP : 25_finance_comptes_paiement.sql
-- Comptes de paiement administrables :
--   * MOBILE_MONEY : numéros (Moov Money, Mixx By Yas...) rattachés à un point
--                    de vente (siège ou succursale) ;
--   * BANQUE       : comptes bancaires utilisés pour les virements et chèques.
-- Aucune information n'est codée en dur : tout se gère depuis l'application.
-- A executer APRES 24_depenses_validation.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS finance_comptes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(20)  NOT NULL,
  prestataire VARCHAR(120) NOT NULL,
  libelle     VARCHAR(150),
  numero      VARCHAR(60)  NOT NULL,
  titulaire   VARCHAR(150),
  point_id    UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL,
  actif       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_finance_comptes_type CHECK (type IN ('MOBILE_MONEY','BANQUE'))
);

COMMENT ON TABLE finance_comptes IS 'Comptes de paiement : numéros mobile money et comptes bancaires.';
CREATE INDEX IF NOT EXISTS idx_finance_comptes_type ON finance_comptes(type);
CREATE INDEX IF NOT EXISTS idx_finance_comptes_point ON finance_comptes(point_id);

DROP TRIGGER IF EXISTS trg_finance_comptes_maj ON finance_comptes;
CREATE TRIGGER trg_finance_comptes_maj BEFORE UPDATE ON finance_comptes
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();

DROP TRIGGER IF EXISTS trg_temps_reel_finance_comptes ON finance_comptes;
CREATE TRIGGER trg_temps_reel_finance_comptes
  AFTER INSERT OR UPDATE OR DELETE ON finance_comptes
  FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel('finance.comptes');

-- -----------------------------------------------------------------------------
-- Permissions : gestion des comptes de paiement
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
('finance.comptes.read',   'finance', 'comptes', 'read',   'Consulter les comptes de paiement', 'Numéros mobile money et comptes bancaires'),
('finance.comptes.create', 'finance', 'comptes', 'create', 'Créer un compte de paiement',       'Ajouter un numéro mobile money ou un compte bancaire'),
('finance.comptes.update', 'finance', 'comptes', 'update', 'Modifier un compte de paiement',    'Mettre à jour un compte de paiement'),
('finance.comptes.delete', 'finance', 'comptes', 'delete', 'Supprimer un compte de paiement',   'Désactiver un compte de paiement')
ON CONFLICT (code) DO NOTHING;

WITH attributions (role_code) AS (VALUES
  ('DG'), ('DGA'), ('DIR_TECHNIQUE'), ('COMPTABLE'), ('TRESORIER')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r ON r.code = a.role_code
JOIN permissions p ON p.code LIKE 'finance.comptes.%'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Jeu de demonstration : numeros mobile money par point de vente + banques.
-- (Modifiable/supprimable depuis l'application : aucune valeur codee en dur.)
-- -----------------------------------------------------------------------------
INSERT INTO finance_comptes (type, prestataire, libelle, numero, titulaire, point_id)
SELECT 'MOBILE_MONEY', 'Moov Money', 'Caisse ' || po.code, '+228 90 00 ' || lpad(po.rang::text, 2, '0') || ' 01',
       'GAE ' || po.nom, po.id
FROM (SELECT id, code, nom, row_number() OVER (ORDER BY code) AS rang FROM pharmacie_points) po
WHERE NOT EXISTS (
  SELECT 1 FROM finance_comptes c
  WHERE c.type = 'MOBILE_MONEY' AND c.prestataire = 'Moov Money' AND c.point_id = po.id
);

INSERT INTO finance_comptes (type, prestataire, libelle, numero, titulaire, point_id)
SELECT 'MOBILE_MONEY', 'Mixx By Yas', 'Caisse ' || po.code, '+228 99 00 ' || lpad(po.rang::text, 2, '0') || ' 02',
       'GAE ' || po.nom, po.id
FROM (SELECT id, code, nom, row_number() OVER (ORDER BY code) AS rang FROM pharmacie_points) po
WHERE NOT EXISTS (
  SELECT 1 FROM finance_comptes c
  WHERE c.type = 'MOBILE_MONEY' AND c.prestataire = 'Mixx By Yas' AND c.point_id = po.id
);

INSERT INTO finance_comptes (type, prestataire, libelle, numero, titulaire, point_id)
SELECT v.type, v.prestataire, v.libelle, v.numero, v.titulaire,
       (SELECT id FROM pharmacie_points WHERE code = v.point_code)
FROM (VALUES
  ('BANQUE', 'Ecobank',   'Compte courant GAE',      '0012345678901', 'GROUPE AGRO EXPERTISE', NULL::text),
  ('BANQUE', 'Orabank',   'Compte siege',            '0098765432100', 'GROUPE AGRO EXPERTISE', 'PH-PRINCIPE'),
  ('BANQUE', 'UBA',       'Compte succursale',        '0055443322110', 'GAE PHARMACIE',        'PH-AGOE')
) AS v(type, prestataire, libelle, numero, titulaire, point_code)
WHERE NOT EXISTS (
  SELECT 1 FROM finance_comptes c
  WHERE c.type = 'BANQUE' AND c.prestataire = v.prestataire AND c.numero = v.numero
);