-- =============================================================================
-- GAE - ERP : 40_role_resp_magasin.sql
-- Role complementaire « Responsable Magasin Pharmacie » : il ouvre le menu et
-- la page « Magasin central » (et ses operations) a un compte qui exerce aussi
-- un autre role (ex. Responsable Pharmacie). Il ne cree PAS de tableau de bord
-- dedie : le tableau de bord du profil principal reste affiche.
--
-- Le magasin central est reserve aux gestionnaires : seuls les profils portant
-- la permission `pharmacie.magasin.acces` voient le menu. Les permissions du
-- module sont accordees a ce role :
--   pharmacie.magasin.acces     -> menu et page « Magasin central »
--   pharmacie.magasin.read      -> consultation du stock et des mouvements
--   pharmacie.magasin.transfert -> ravitaillement des pharmacies
--   pharmacie.magasin.commande  -> commandes aux firmes
--   pharmacie.magasin.reception -> receptions fournisseurs dans le magasin
--
-- Le role n'est pas « systeme » : il reste modifiable depuis
-- Administration > Roles (permissions, libelle, activation).
--
-- A executer APRES 39_magasin_acces_permission.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Role metier du magasin central.
-- -----------------------------------------------------------------------------
INSERT INTO roles (code, nom, description, departement_id, niveau, systeme, actif)
SELECT
  'RESP_MAGASIN',
  'Responsable Magasin Pharmacie',
  'Gestion du magasin central : ouvre le menu et les operations du magasin (stock, ravitaillement, commandes aux firmes, receptions). A attribuer en complement d''un autre role.',
  (SELECT id FROM departements WHERE code = 'PHARMA'),
  25,
  FALSE,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'RESP_MAGASIN');

-- Alignement du libelle sur les bases deja migrees (script rejouable).
UPDATE roles
   SET nom = 'Responsable Magasin Pharmacie',
       description = 'Gestion du magasin central : ouvre le menu et les operations du magasin (stock, ravitaillement, commandes aux firmes, receptions). A attribuer en complement d''un autre role.'
 WHERE code = 'RESP_MAGASIN';

-- -----------------------------------------------------------------------------
-- 2. Permissions du magasin accordees au role.
-- -----------------------------------------------------------------------------
WITH attributions (permission_code) AS (VALUES
  ('pharmacie.magasin.acces'),
  ('pharmacie.magasin.read'),
  ('pharmacie.magasin.transfert'),
  ('pharmacie.magasin.commande'),
  ('pharmacie.magasin.reception')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = 'RESP_MAGASIN'
JOIN permissions p ON p.code = a.permission_code
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Rappel : le responsable de pharmacie conserve son exclusion du magasin.
-- -----------------------------------------------------------------------------
DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'RESP_PHARMACIE'
  AND p.code LIKE 'pharmacie.magasin.%';