-- =============================================================================
-- GAE - ERP : 51_clinique_factures_direction.sql
-- Module Clinique : elargissement des droits de facturation.
-- Toute personne ayant acces a l'ecran Factures de la clinique doit pouvoir
-- generer la facture d'un passage (et l'encaisser) : la Direction (DG, DGA) et
-- les profils qui exploitent le guichet (Comptable, Responsable pharmacie).
-- L'Auditeur reste en lecture seule (mission d'audit).
-- A executer APRES 50_clinique_seed.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

WITH attributions (role_code, permissions) AS (VALUES
  ('DG',             ARRAY['clinique.factures.create', 'clinique.factures.update', 'clinique.factures.validate']),
  ('DGA',            ARRAY['clinique.factures.create', 'clinique.factures.update', 'clinique.factures.validate']),
  ('DIR_TECHNIQUE',  ARRAY['clinique.factures.create', 'clinique.factures.update', 'clinique.factures.validate']),
  ('RESP_CLINIQUE',  ARRAY['clinique.factures.create', 'clinique.factures.update', 'clinique.factures.validate']),
  ('RESP_PHARMACIE', ARRAY['clinique.factures.create', 'clinique.factures.validate']),
  ('COMPTABLE',      ARRAY['clinique.factures.create', 'clinique.factures.update']),
  ('TRESORIER',      ARRAY['clinique.factures.create']),
  ('TECHNICIEN',     ARRAY['clinique.factures.create', 'clinique.factures.update', 'clinique.factures.validate'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = ANY (a.permissions)
ON CONFLICT DO NOTHING;

-- Controle rapide (decommenter au besoin) :
-- SELECT r.code, p.code
-- FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.module = 'clinique' AND p.ressource = 'factures'
-- ORDER BY r.code, p.code;