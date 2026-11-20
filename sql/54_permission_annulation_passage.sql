-- =============================================================================
-- GAE - ERP : 54_permission_annulation_passage.sql
-- Module Clinique : permission dediee a l'annulation d'un passage saisi a
-- l'accueil (`clinique.consultations.delete`).
--
-- Pourquoi : le service d'accueil clinique doit pouvoir annuler un passage
-- (mauvais animal, double saisie...) sans detenir `consultations.validate`, qui
-- autorise aussi la cloture du dossier medical.
-- A executer APRES 53_role_accueil_clinique.sql (idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- L'action `delete` est la seule valeur admise par la contrainte de la table
-- `permissions` pour un retrait (cf. ck_permissions_action).
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('clinique.consultations.delete', 'clinique', 'consultations', 'delete',
   'Annuler un passage', 'Annuler une consultation enregistree a l''accueil')
ON CONFLICT (code) DO NOTHING;

WITH attributions (role_code) AS (VALUES
  ('SUPER_ADMIN'),
  ('DIR_TECHNIQUE'),
  ('RESP_CLINIQUE'),
  ('TECHNICIEN'),
  ('ACCUEIL_CLINIQUE')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = 'clinique.consultations.delete'
ON CONFLICT DO NOTHING;

-- Controle rapide (decommenter au besoin) :
-- SELECT r.code FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code = 'clinique.consultations.delete' ORDER BY r.code;