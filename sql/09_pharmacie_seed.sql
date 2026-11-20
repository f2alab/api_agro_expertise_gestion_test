-- Module Pharmacie : donnees de reference (points de vente, produits,
-- parametrage local, fournisseurs, stock initial).
-- A executer APRES 08_pharmacie_permissions.sql.
-- Insertions idempotentes (ON CONFLICT DO NOTHING) : le jeu peut etre rejoue.

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Points de vente (siege + succursales)
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_points (code, nom, departement_id, type_point, ville, telephone) VALUES
('PH-PRINCIPE', 'Pharmacie du Siege', (SELECT id FROM departements WHERE code = 'PHARMA'),      'SIEGE',      'Lome',     '+228 90 00 00 01'),
('PH-AGOE',     'Pharmacie Agoe',     (SELECT id FROM departements WHERE code = 'PHARMA_SUCC'), 'SUCCURSALE', 'Agoe',     '+228 90 00 00 02'),
('PH-KPALIME',  'Pharmacie Kpalime',  (SELECT id FROM departements WHERE code = 'PHARMA_SUCC'), 'SUCCURSALE', 'Kpalime',  '+228 90 00 00 03'),
('PH-DJIDJOLE', 'Pharmacie Djidjole', (SELECT id FROM departements WHERE code = 'PHARMA_SUCC'), 'SUCCURSALE', 'Lome',     '+228 90 00 00 04')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Referentiel central des produits
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_produits
  (code, dci, nom_commercial, forme_galenique, dosage, presentation, categorie,
   unite_mesure, necessite_ordonnance, tva_taux, laboratoire)
VALUES
('MED-IVERMECT', 'Ivermectine',       'Ivermectine 1% injectable', 'INJECTABLE', '1%',     'Flacon 50 ml',   'CAT001', 'UN002', TRUE,  18.00, 'CEVA'),
('MED-OXYTETRA', 'Oxytetracycline',   'Oxytetracycline 20% LP',    'INJECTABLE', '20%',    'Flacon 100 ml',  'CAT001', 'UN002', TRUE,  18.00, 'CEVA'),
('MED-ALBENDAZ', 'Albendazole',       'Albendazole 2500 mg',       'BOLUS',      '2500mg', 'Boite 10 bolus', 'CAT001', 'UN003', FALSE, 18.00, 'VETOQUINOL'),
('MED-TYLOSINE', 'Tylosine',          'Tylosine 20% injectable',   'INJECTABLE', '20%',    'Flacon 100 ml',  'CAT001', 'UN002', TRUE,  18.00, 'HUVEPHARMA'),
('VAC-NEWCASTLE',NULL,                'Vaccin Newcastle H120',     'VACCIN',     NULL,     'Flacon 1000 doses', 'CAT002', 'UN002', FALSE, 0.00, 'CEVA'),
('ALIM-PRESTART',NULL,               'Aliment demarrage poulet',   'GRANULE',    NULL,     'Sac 25 kg',      'CAT003',         'UN004', FALSE, 0.00, 'SIVOP'),
('MATE-SERINGUE',NULL,               'Seringue automatique 5 ml',  'MATERIEL',   NULL,     'Unite',          'CAT005',        'UN001',  FALSE, 18.00, NULL)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Parametrage local : chaque point de vente recoit le referentiel avec ses
--    propres prix, seuils et disponibilite (prix par produit via CTE).
-- -----------------------------------------------------------------------------
WITH prix (produit_code, prix_achat, prix_vente, seuil) AS (VALUES
  ('MED-IVERMECT',  2500::numeric,  3500::numeric, 10),
  ('MED-OXYTETRA',  3200::numeric,  4500::numeric, 10),
  ('MED-ALBENDAZ',  1800::numeric,  2500::numeric,  8),
  ('MED-TYLOSINE',  2800::numeric,  4000::numeric, 10),
  ('VAC-NEWCASTLE', 1200::numeric,  2000::numeric, 15),
  ('ALIM-PRESTART', 18000::numeric, 22000::numeric, 5),
  ('MATE-SERINGUE', 4500::numeric,  6500::numeric, 3)
)
INSERT INTO pharmacie_produits_points (produit_id, point_id, prix_vente, prix_achat_reference, seuil_alerte)
SELECT pr.id, po.id, px.prix_vente, px.prix_achat, px.seuil
FROM prix px
JOIN pharmacie_produits pr ON pr.code = px.produit_code
CROSS JOIN pharmacie_points po
ON CONFLICT (produit_id, point_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Fournisseurs
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_fournisseurs (code, nom, contact, telephone, ville, conditions_paiement, delai_livraison_jours) VALUES
('FOUR-CEVA',  'CEVA Sante Animale',    'Service commercial',  '+228 22 00 00 00', 'Lome', '30 jours', 7),
('FOUR-HUVE',  'Huvepharma Afrique',    'Approvisionnement',   '+228 22 00 00 01', 'Lome', 'Comptant',  14),
('FOUR-COOP',  'Cooperative Veterinaire','Direction',          '+228 22 00 00 02', 'Kara', '15 jours', 10)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Stock initial du siege : un lot + une entree par produit du referentiel.
--    Fournit des donnees pour la valorisation et les tableaux de bord.
-- -----------------------------------------------------------------------------
WITH siege AS (SELECT id FROM pharmacie_points WHERE code = 'PH-PRINCIPE')
INSERT INTO pharmacie_lots (point_id, produit_id, numero_lot, date_peremption, prix_achat_unitaire, quantite_entree)
SELECT siege.id, pr.id, 'LOT-' || pr.code, CURRENT_DATE + 365, pp.prix_achat_reference, 60
FROM siege
JOIN pharmacie_produits pr ON pr.actif = TRUE
JOIN pharmacie_produits_points pp ON pp.produit_id = pr.id AND pp.point_id = siege.id
ON CONFLICT DO NOTHING;

WITH siege AS (SELECT id FROM pharmacie_points WHERE code = 'PH-PRINCIPE')
INSERT INTO pharmacie_mouvements_stock
  (point_id, produit_id, type_mouvement, quantite, prix_unitaire, motif, reference_type)
SELECT siege.id, pr.id, 'ENTREE', 60, pp.prix_achat_reference, 'Stock initial', 'SEED'
FROM siege
JOIN pharmacie_produits pr ON pr.actif = TRUE
JOIN pharmacie_produits_points pp ON pp.produit_id = pr.id AND pp.point_id = siege.id;