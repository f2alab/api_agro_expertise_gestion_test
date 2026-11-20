-- =============================================================================
-- GAE - ERP : 53_role_accueil_clinique.sql
-- Nouveau role « Accueil clinique » : agent qui enregistre les animaux, leurs
-- proprietaires et les passages a l'accueil de la clinique.
--
-- Perimetre volontairement limite :
--   * consultations : lire (file d'attente) + creer (passage et frais) ;
--   * proprietaires : lire, creer, modifier, desactiver ;
--   * animaux       : lire, creer, modifier, desactiver ;
--   * referentiels  : lire (especes proposees a l'accueil).
-- Aucun acces aux examens, au paraclinique, aux ordonnances ni aux factures.
-- A executer APRES 52_clinique_accueil_roles.sql (idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- Role metier (non systeme : il reste supprimable/modifiable par l'IAM).
INSERT INTO roles (code, nom, description, departement_id, niveau, systeme) VALUES
  ('ACCUEIL_CLINIQUE', 'Accueil clinique',
   'Enregistrement des animaux, des proprietaires et des passages a la clinique',
   (SELECT id FROM departements WHERE code = 'CLIN'), 60, FALSE)
ON CONFLICT (code) DO NOTHING;

-- Permissions du role.
WITH attributions (permissions) AS (VALUES (ARRAY[
  'clinique.consultations.read',
  'clinique.consultations.create',
  'clinique.proprietaires.read',
  'clinique.proprietaires.create',
  'clinique.proprietaires.update',
  'clinique.proprietaires.delete',
  'clinique.animaux.read',
  'clinique.animaux.create',
  'clinique.animaux.update',
  'clinique.animaux.delete',
  'clinique.referentiels.read'
]))
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = 'ACCUEIL_CLINIQUE'
JOIN permissions p ON p.code = ANY (a.permissions)
ON CONFLICT DO NOTHING;

-- Controle rapide (decommenter au besoin) :
-- SELECT p.code FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE r.code = 'ACCUEIL_CLINIQUE' ORDER BY p.code;