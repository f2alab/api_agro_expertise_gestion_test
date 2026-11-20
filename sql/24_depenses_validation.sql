-- =============================================================================
-- GAE - ERP : 24_depenses_validation.sql
--   1. Statut "EN_ATTENTE" pour les dépenses soumises (au lieu de BROUILLON).
--   2. Validation d'une dépense réservée à la DG, la DGA et le Comptable.
-- A executer APRES 23_referentiels_codes_rayon_3_chiffres.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- 1. Statut EN_ATTENTE -------------------------------------------------------
ALTER TABLE finance_depenses DROP CONSTRAINT IF EXISTS ck_finance_depense_statut;
UPDATE finance_depenses SET statut = 'EN_ATTENTE' WHERE statut = 'BROUILLON';
ALTER TABLE finance_depenses
  ADD CONSTRAINT ck_finance_depense_statut
  CHECK (statut IN ('EN_ATTENTE','VALIDEE','ANNULEE'));

-- 2. Permissions de validation ----------------------------------------------
-- Accorder la validation a la DG et a la DGA (le Comptable l'a deja via finance.%).
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('DG','DGA') AND p.code = 'finance.depenses.validate'
ON CONFLICT DO NOTHING;

-- Retirer la validation aux profils non habilites (tresorier, resp. pharmacie).
DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code IN ('TRESORIER','RESP_PHARMACIE')
  AND p.code = 'finance.depenses.validate';