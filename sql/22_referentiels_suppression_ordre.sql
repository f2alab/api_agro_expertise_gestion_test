-- =============================================================================
-- GAE - ERP : 22_referentiels_suppression_ordre.sql
-- Supprime la colonne "ordre" des referentiels produits : le CODE est desormais
-- genere automatiquement (CAT001, UN001, RAY001...) et non plus saisi, et
-- l'ordre d'affichage suit le code.
-- A executer APRES 21_referentiels_produits.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

ALTER TABLE pharmacie_referentiels DROP COLUMN IF EXISTS ordre;