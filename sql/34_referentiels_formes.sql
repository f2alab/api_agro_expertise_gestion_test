-- =============================================================================
-- GAE - ERP : 34_referentiels_formes.sql
-- Ajoute le type de referentiel « FORME » : gestion des formes de produits comme
-- les familles, unites de comptage et rayons.
-- A executer APRES 33_produits_forme_optionnels.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Autorise le nouveau type FORME dans les referentiels produits.
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_referentiels DROP CONSTRAINT IF EXISTS ck_pharmacie_ref_type;
ALTER TABLE pharmacie_referentiels ADD CONSTRAINT ck_pharmacie_ref_type
  CHECK (type IN ('CATEGORIE', 'UNITE', 'RAYON', 'FORME'));

COMMENT ON COLUMN pharmacie_produits.forme IS 'Forme du produit (code referentiel type FORME), facultatif.';

-- -----------------------------------------------------------------------------
-- Formes de depart (l utilisateur peut les completer / modifier / supprimer).
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_referentiels (type, code, libelle) VALUES
('FORME', 'FORM001', 'Comprime'),
('FORME', 'FORM002', 'Capsule'),
('FORME', 'FORM003', 'Sirop'),
('FORME', 'FORM004', 'Solution'),
('FORME', 'FORM005', 'Injectable'),
('FORME', 'FORM006', 'Pommade'),
('FORME', 'FORM007', 'Poudre'),
('FORME', 'FORM008', 'Granule'),
('FORME', 'FORM009', 'Bolus'),
('FORME', 'FORM010', 'Spray')
ON CONFLICT (type, code) DO NOTHING;