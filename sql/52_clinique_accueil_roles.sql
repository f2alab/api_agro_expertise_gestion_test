-- =============================================================================
-- GAE - ERP : 52_clinique_accueil_roles.sql
-- Module Clinique : accueil ouvert a tous les profils qui accedent au module.
-- L'ecran d'accueil a besoin de quatre droits pour fonctionner :
--   * clinique.consultations.read    : file d'attente du jour ;
--   * clinique.consultations.create  : enregistrement d'un passage (et frais) ;
--   * clinique.proprietaires.read    : choix / creation du proprietaire ;
--   * clinique.animaux.read          : choix de l'animal (+ referentiels).
-- Les profils qui disposaient deja de ces droits (Directeur Technique,
-- Responsable clinique, Technicien, super administrateur) ne sont pas listes.
-- L'Auditeur reste volontairement en lecture seule (role d'audit du socle IAM).
-- A executer APRES 51_clinique_factures_direction.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

WITH attributions (role_code) AS (VALUES
  ('DG'),
  ('DGA'),
  ('RESP_PARACLINIQUE'),
  ('RESP_ZOO'),
  ('RESP_AMEL'),
  ('RESP_PHARMACIE'),
  ('CHARGE_RDN'),
  ('COMPTABLE'),
  ('TRESORIER'),
  ('STAGIAIRE')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = ANY (ARRAY[
  'clinique.consultations.read',
  'clinique.consultations.create',
  'clinique.proprietaires.read',
  'clinique.animaux.read'
])
ON CONFLICT DO NOTHING;

-- Controle rapide (decommenter au besoin) :
-- SELECT r.code, count(*) AS nb
-- FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code IN ('clinique.consultations.read','clinique.consultations.create',
--                  'clinique.proprietaires.read','clinique.animaux.read')
-- GROUP BY r.code ORDER BY r.code;