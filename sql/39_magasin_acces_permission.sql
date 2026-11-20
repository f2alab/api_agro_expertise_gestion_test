-- =============================================================================
-- GAE - ERP : 39_magasin_acces_permission.sql
-- Acces au magasin central : permission dediee aux gestionnaires du magasin.
--
-- Objectif metier :
--   - le menu « Magasin central » n'est plus visible par les responsables de
--     pharmacie ;
--   - l'acces au menu, a la page et aux donnees du magasin est pilote par la
--     permission `pharmacie.magasin.acces` ;
--   - cette permission est attribuee par defaut a la direction, au controle,
--     au directeur technique et au super administrateur.
--
-- A executer APRES 38_magasin_central.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Nouvelle permission d'acces au module magasin central.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('pharmacie.magasin.acces',
   'pharmacie',
   'magasin',
   'read',
   'Acceder au magasin central',
   'Voir le menu et acceder au magasin central (gestionnaires)')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Attribution par defaut : direction, controle et directeur technique.
-- -----------------------------------------------------------------------------
WITH attributions (role_code, permission_code) AS (VALUES
  ('DG',            'pharmacie.magasin.acces'),
  ('DGA',           'pharmacie.magasin.acces'),
  ('DIR_TECHNIQUE', 'pharmacie.magasin.acces'),
  ('COMPTABLE',     'pharmacie.magasin.acces'),
  ('TRESORIER',     'pharmacie.magasin.acces'),
  ('AUDITEUR',      'pharmacie.magasin.acces'),
  ('SUPER_ADMIN',   'pharmacie.magasin.acces')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = a.permission_code
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Retrait de l'acces au magasin pour le responsable de pharmacie.
--    (le seed 04 lui accorde `pharmacie.%` par motif : on corrige ici)
-- -----------------------------------------------------------------------------
DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'RESP_PHARMACIE'
  AND p.code LIKE 'pharmacie.magasin.%';