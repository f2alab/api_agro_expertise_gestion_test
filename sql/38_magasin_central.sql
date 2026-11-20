-- =============================================================================
-- GAE - ERP : 38_magasin_central.sql
-- Magasin central du siege : stock tampon entre les firmes et les pharmacies.
--
-- Flux metier vise :
--   1. le siege commande aux firmes ; les produits sont d'abord stockes dans le
--      MAGASIN (et non directement dans une pharmacie) ;
--   2. le magasin ravitaille ensuite les pharmacies (siege et succursales) ;
--   3. quand une pharmacie est en rupture, elle est reapprovisionnee depuis le
--      magasin ;
--   4. quand le magasin est en rupture (ou sous son seuil), une commande est
--      lancee chez les firmes.
--
-- Decision d'architecture : le magasin est modelise comme un POINT DE STOCK
-- dedie (pharmacie_points.type_point = 'MAGASIN'). Il beneficie ainsi de toute
-- l'infrastructure existante (lots, mouvements, valorisation, alertes, FEFO,
-- commandes / receptions) sans dupliquer de logique.
--
-- A executer APRES 37_rapports_depenses_approuvees.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Autoriser le type de point MAGASIN (contrainte remplacee, donc rejouable).
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_points DROP CONSTRAINT IF EXISTS ck_pharmacie_points_type;
ALTER TABLE pharmacie_points
  ADD CONSTRAINT ck_pharmacie_points_type
  CHECK (type_point IN ('SIEGE', 'SUCCURSALE', 'MAGASIN'));

-- -----------------------------------------------------------------------------
-- 2. Creation du magasin central du siege.
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_points
  (code, nom, departement_id, type_point, ville, adresse, telephone, devise, actif)
VALUES
  ('MAG-PRINCIPE',
   'Magasin Central du Siege',
   (SELECT id FROM departements WHERE code = 'PHARMA'),
   'MAGASIN',
   'Lome',
   'Siege du Groupe Agro-Expertise',
   '+228 90 00 00 00',
   'XOF',
   TRUE)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Parametrage local des produits dans le magasin.
--    On reprend les prix d'achat / de vente du reseau et on applique un seuil
--    de reapprovisionnement (au moins 10 unites, ou le seuil le plus eleve).
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_produits_points
  (produit_id, point_id, prix_vente, prix_achat_reference, seuil_alerte, disponible)
SELECT
  pr.id,
  mag.id,
  COALESCE(agg.prix_vente, 0),
  COALESCE(agg.prix_achat, 0),
  COALESCE(agg.seuil, 10),
  TRUE
FROM pharmacie_produits pr
CROSS JOIN (SELECT id FROM pharmacie_points WHERE code = 'MAG-PRINCIPE') mag
LEFT JOIN (
  SELECT produit_id,
         MAX(prix_vente)            AS prix_vente,
         MAX(prix_achat_reference)  AS prix_achat,
         MAX(seuil_alerte)          AS seuil
  FROM pharmacie_produits_points
  GROUP BY produit_id
) agg ON agg.produit_id = pr.id
WHERE pr.actif
ON CONFLICT (produit_id, point_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Stock initial du magasin (demonstration / amorcage).
--    Un lot + une entree par produit, uniquement si le magasin n'a encore
--    aucun mouvement pour ce produit (idempotent).
-- -----------------------------------------------------------------------------
WITH magasin AS (SELECT id, telephone FROM pharmacie_points WHERE code = 'MAG-PRINCIPE')
INSERT INTO pharmacie_lots
  (point_id, produit_id, numero_lot, date_peremption, prix_achat_unitaire, quantite_entree)
SELECT
  magasin.id,
  pr.id,
  'MAG-LOT-' || pr.code,
  CURRENT_DATE + 365,
  pp.prix_achat_reference,
  60
FROM magasin
JOIN pharmacie_produits pr ON pr.actif = TRUE
JOIN pharmacie_produits_points pp
  ON pp.produit_id = pr.id AND pp.point_id = magasin.id
WHERE NOT EXISTS (
  SELECT 1 FROM pharmacie_mouvements_stock m
  WHERE m.point_id = magasin.id AND m.produit_id = pr.id
);

WITH magasin AS (SELECT id FROM pharmacie_points WHERE code = 'MAG-PRINCIPE')
INSERT INTO pharmacie_mouvements_stock
  (point_id, produit_id, type_mouvement, quantite, prix_unitaire, motif, reference_type)
SELECT
  magasin.id,
  pr.id,
  'ENTREE',
  60,
  pp.prix_achat_reference,
  'Stock initial du magasin',
  'SEED'
FROM magasin
JOIN pharmacie_produits pr ON pr.actif = TRUE
JOIN pharmacie_produits_points pp
  ON pp.produit_id = pr.id AND pp.point_id = magasin.id
WHERE NOT EXISTS (
  SELECT 1 FROM pharmacie_mouvements_stock m
  WHERE m.point_id = magasin.id AND m.produit_id = pr.id
);
-- -----------------------------------------------------------------------------
-- 5. Les fournisseurs EXTERNES (firmes) restent rattaches a la pharmacie du
--    siege. Le magasin central peut toutefois les utiliser pour passer commande
--    (regle appliquee dans commandes.service.js) : inutile de les deplacer.
--    Cette section remet aussi a niveau une base ou ils auraient ete deplaces.
-- -----------------------------------------------------------------------------
UPDATE pharmacie_fournisseurs
SET point_id = (SELECT id FROM pharmacie_points WHERE type_point = 'SIEGE' ORDER BY code LIMIT 1)
WHERE type_fournisseur = 'EXTERNE'
  AND (
    point_id IS NULL
    OR point_id = (SELECT id FROM pharmacie_points WHERE code = 'MAG-PRINCIPE')
  );

-- -----------------------------------------------------------------------------
-- 6. Les fournisseurs INTERNES (approvisionnement intra-reseau) pointent vers
--    le magasin : une reception interne debite donc le magasin et credite la
--    pharmacie destinataire.
-- -----------------------------------------------------------------------------
UPDATE pharmacie_fournisseurs f
SET point_source_id = mag.id
FROM (SELECT id FROM pharmacie_points WHERE code = 'MAG-PRINCIPE') mag
WHERE f.type_fournisseur = 'INTERNE';

UPDATE pharmacie_fournisseurs
SET nom = 'Magasin Central (approvisionnement interne)'
WHERE type_fournisseur = 'INTERNE'
  AND nom = 'Pharmacie du Siège (approvisionnement interne)';

-- Fournisseur interne de la pharmacie du siege (elle aussi ravitailee par le
-- magasin). Les succursales disposent deja de leur ligne INTERNE.
INSERT INTO pharmacie_fournisseurs
  (code, nom, contact, telephone, ville, conditions_paiement,
   type_fournisseur, point_source_id, actif)
SELECT
  'INT-' || p.code,
  'Magasin Central (approvisionnement interne)',
  'Gestion du magasin',
  mag.telephone,
  p.ville,
  'Interne',
  'INTERNE',
  mag.id,
  TRUE
FROM pharmacie_points p
CROSS JOIN (SELECT id, telephone FROM pharmacie_points WHERE code = 'MAG-PRINCIPE') mag
WHERE p.type_point = 'SIEGE'
ON CONFLICT (code) DO NOTHING;
-- -----------------------------------------------------------------------------
-- 7. Permissions du magasin.
--    `acces` ouvre le menu et le module aux gestionnaires du magasin central ;
--    `read`, `transfert`, `commande` et `reception` regissent les operations.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('pharmacie.magasin.acces',     'pharmacie', 'magasin', 'read',     'Acceder au magasin central', 'Voir le menu et acceder au magasin central (gestionnaires)'),
  ('pharmacie.magasin.read',      'pharmacie', 'magasin', 'read',     'Consulter le magasin',      'Voir le stock et les entrees/sorties du magasin central'),
  ('pharmacie.magasin.transfert', 'pharmacie', 'magasin', 'manage',   'Ravitaillement magasin',    'Transferer des produits du magasin vers une pharmacie'),
  ('pharmacie.magasin.commande',  'pharmacie', 'magasin', 'create',   'Commander pour le magasin', 'Lancer une commande fournisseur pour le magasin'),
  ('pharmacie.magasin.reception', 'pharmacie', 'magasin', 'validate', 'Receptionner au magasin',   'Receptionner une commande fournisseur dans le magasin')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 8. Attribution aux profils.
--    Acces et lecture : DG, DGA, Directeur Technique, Comptable, Tresorier,
--              Auditeur et super administrateur.
--    Operation (ravitaillement / commande / reception) : Directeur Technique
--              et super administrateur.
--    Le responsable de pharmacie n'a AUCUN acces au magasin central : ce
--    module est reserve aux gestionnaires du magasin.
-- -----------------------------------------------------------------------------
WITH attributions (role_code, permission_code) AS (VALUES
  ('DG',              'pharmacie.magasin.acces'),
  ('DG',              'pharmacie.magasin.read'),
  ('DGA',             'pharmacie.magasin.acces'),
  ('DGA',             'pharmacie.magasin.read'),
  ('DIR_TECHNIQUE',   'pharmacie.magasin.acces'),
  ('DIR_TECHNIQUE',   'pharmacie.magasin.read'),
  ('DIR_TECHNIQUE',   'pharmacie.magasin.transfert'),
  ('DIR_TECHNIQUE',   'pharmacie.magasin.commande'),
  ('DIR_TECHNIQUE',   'pharmacie.magasin.reception'),
  ('COMPTABLE',       'pharmacie.magasin.acces'),
  ('COMPTABLE',       'pharmacie.magasin.read'),
  ('TRESORIER',       'pharmacie.magasin.acces'),
  ('TRESORIER',       'pharmacie.magasin.read'),
  ('AUDITEUR',        'pharmacie.magasin.acces'),
  ('AUDITEUR',        'pharmacie.magasin.read'),
  ('SUPER_ADMIN',     'pharmacie.magasin.acces'),
  ('SUPER_ADMIN',     'pharmacie.magasin.read'),
  ('SUPER_ADMIN',     'pharmacie.magasin.transfert'),
  ('SUPER_ADMIN',     'pharmacie.magasin.commande'),
  ('SUPER_ADMIN',     'pharmacie.magasin.reception')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = a.permission_code
ON CONFLICT DO NOTHING;

-- Retrait de tout acces magasin au responsable de pharmacie (rejouable : le
-- seed 04 accorde `pharmacie.%` a ce role par motif, on corrige ici).
DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'RESP_PHARMACIE'
  AND p.code LIKE 'pharmacie.magasin.%';