-- =============================================================================
-- GAE - ERP : 21_referentiels_produits.sql
-- Referentiels des produits (categories, unites de mesure, rayons) gerables
-- par l'utilisateur, et emplacement "rayon" sur la fiche produit.
-- A executer APRES 20_clients_fournisseurs_isolation.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Table : pharmacie_referentiels
-- Un referentiel = un couple (type, code). Le libelle est affiche dans l'UI.
--   type : CATEGORIE | UNITE | RAYON
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacie_referentiels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(20)  NOT NULL,
  code        VARCHAR(60)  NOT NULL,
  libelle     VARCHAR(150) NOT NULL,
  description TEXT,
  actif       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_ref_type CHECK (type IN ('CATEGORIE','UNITE','RAYON')),
  CONSTRAINT uq_pharmacie_ref_type_code UNIQUE (type, code)
);

COMMENT ON TABLE pharmacie_referentiels IS 'Referentiels des produits : categories, unites de mesure, rayons.';
CREATE INDEX IF NOT EXISTS idx_pharmacie_referentiels_type ON pharmacie_referentiels(type);

-- -----------------------------------------------------------------------------
-- Emplacement "rayon" sur la fiche produit (code de referentiel type RAYON).
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_produits ADD COLUMN IF NOT EXISTS rayon VARCHAR(60);
COMMENT ON COLUMN pharmacie_produits.rayon IS 'Rayon/emplacement (code referentiel type RAYON).';
CREATE INDEX IF NOT EXISTS idx_pharmacie_produits_rayon ON pharmacie_produits(rayon);

-- -----------------------------------------------------------------------------
-- Donnees de depart (reprend les anciennes valeurs figees de l'API).
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_referentiels (type, code, libelle) VALUES
('CATEGORIE','CAT001','Medicament veterinaire'),
('CATEGORIE','CAT002','Vaccin'),
('CATEGORIE','CAT003','Aliment'),
('CATEGORIE','CAT004','Hygiene'),
('CATEGORIE','CAT005','Materiel'),
('CATEGORIE','CAT006','Autre'),
('UNITE','UN001','Unite'),
('UNITE','UN002','Flacon'),
('UNITE','UN003','Boite'),
('UNITE','UN004','Sac'),
('UNITE','UN005','Sachet'),
('UNITE','UN006','Litre'),
('UNITE','UN007','Kilogramme'),
('UNITE','UN008','Dose'),
('RAYON','RAY001','Rayon A - Medicaments'),
('RAYON','RAY002','Rayon B - Vaccins'),
('RAYON','RAY003','Rayon C - Aliments'),
('RAYON','RAY004','Rayon D - Materiel'),
('RAYON','RAY005','Rayon E - Hygiene')
ON CONFLICT (type, code) DO NOTHING;

-- Reprise des valeurs deja presentes sur les produits (robustesse).
INSERT INTO pharmacie_referentiels (type, code, libelle)
SELECT 'CATEGORIE', pr.categorie, pr.categorie
FROM pharmacie_produits pr
WHERE pr.categorie IS NOT NULL AND btrim(pr.categorie) <> ''
GROUP BY pr.categorie
ON CONFLICT (type, code) DO NOTHING;

INSERT INTO pharmacie_referentiels (type, code, libelle)
SELECT 'UNITE', pr.unite_mesure, pr.unite_mesure
FROM pharmacie_produits pr
WHERE pr.unite_mesure IS NOT NULL AND btrim(pr.unite_mesure) <> ''
GROUP BY pr.unite_mesure
ON CONFLICT (type, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Triggers : updated_at + temps reel
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_pharmacie_referentiels_maj ON pharmacie_referentiels;
CREATE TRIGGER trg_pharmacie_referentiels_maj BEFORE UPDATE ON pharmacie_referentiels
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();

DROP TRIGGER IF EXISTS trg_temps_reel_pharmacie_referentiels ON pharmacie_referentiels;
CREATE TRIGGER trg_temps_reel_pharmacie_referentiels
  AFTER INSERT OR UPDATE OR DELETE ON pharmacie_referentiels
  FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel('pharmacie.referentiels');