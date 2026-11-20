-- =============================================================================
-- GAE - ERP : 33_produits_forme_optionnels.sql
-- Fiche produit : ajout du champ « forme » et passage des champs famille
-- (ex-categorie) et unite de comptage (ex-unite de mesure) en facultatifs.
-- A executer APRES 32_lots_peremption.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Nouveau champ : forme du produit.
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_produits ADD COLUMN IF NOT EXISTS forme VARCHAR(60);
COMMENT ON COLUMN pharmacie_produits.forme IS 'Forme du produit (ex. comprime, sirop, pommade).';

-- -----------------------------------------------------------------------------
-- Champs facultatifs : la famille (ex-categorie) et l'unite de comptage
-- (ex-unite de mesure) ne sont plus obligatoires sur la fiche produit.
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_produits ALTER COLUMN categorie DROP NOT NULL;
ALTER TABLE pharmacie_produits ALTER COLUMN categorie DROP DEFAULT;
ALTER TABLE pharmacie_produits ALTER COLUMN unite_mesure DROP NOT NULL;
ALTER TABLE pharmacie_produits ALTER COLUMN unite_mesure DROP DEFAULT;

COMMENT ON COLUMN pharmacie_produits.categorie IS 'Famille du produit (code referentiel type CATEGORIE), facultatif.';
COMMENT ON COLUMN pharmacie_produits.unite_mesure IS 'Unite de comptage (code referentiel type UNITE), facultatif.';
