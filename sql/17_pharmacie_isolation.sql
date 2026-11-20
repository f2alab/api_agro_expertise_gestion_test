-- =============================================================================
-- GAE - ERP : 17_pharmacie_isolation.sql
-- Isolation des pharmacies et approvisionnement interne.
--
--   1. utilisateurs.point_vente_id : rattache un compte (ex. PPV) à UNE
--      pharmacie. Dès la connexion, ses opérations sont limitées à cette
--      pharmacie ; les transactions restent centralisées dans le grand livre.
--   2. pharmacie_fournisseurs.type_fournisseur / point_source_id : distingue
--      les fournisseurs EXTERNES de l'approvisionnement INTERNE. La pharmacie
--      du siège devient le fournisseur interne principal des succursales.
--
-- A exécuter APRES 16_finances_permissions.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Rattachement d'un compte utilisateur à une pharmacie (point de vente)
-- -----------------------------------------------------------------------------
ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS point_vente_id UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL;

COMMENT ON COLUMN utilisateurs.point_vente_id IS
  'Pharmacie de rattachement (périmètre d''opération d''un PPV / technicien).';

CREATE INDEX IF NOT EXISTS idx_utilisateurs_point_vente ON utilisateurs(point_vente_id);

-- -----------------------------------------------------------------------------
-- 2. Fournisseurs internes / externes
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_fournisseurs
  ADD COLUMN IF NOT EXISTS type_fournisseur VARCHAR(20) NOT NULL DEFAULT 'EXTERNE';

ALTER TABLE pharmacie_fournisseurs
  ADD COLUMN IF NOT EXISTS point_source_id UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL;

COMMENT ON COLUMN pharmacie_fournisseurs.type_fournisseur IS
  'EXTERNE (laboratoire, grossiste) ou INTERNE (autre pharmacie du réseau, ex. le siège).';
COMMENT ON COLUMN pharmacie_fournisseurs.point_source_id IS
  'Pharmacie source lorsque le fournisseur est INTERNE (approvisionnement intra-réseau).';

CREATE INDEX IF NOT EXISTS idx_pharmacie_fournisseurs_point_source
  ON pharmacie_fournisseurs(point_source_id);

-- Contrainte de domaine (ajoutée si absente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_pharmacie_fournisseur_type'
  ) THEN
    ALTER TABLE pharmacie_fournisseurs
      ADD CONSTRAINT ck_pharmacie_fournisseur_type
      CHECK (type_fournisseur IN ('EXTERNE','INTERNE'));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Fournisseur interne : la pharmacie du siège approvisionne les succursales.
--    Une ligne "INTERNE" est créée par succursale, pointant vers le siège.
-- -----------------------------------------------------------------------------
WITH siege AS (
  SELECT id, telephone FROM pharmacie_points
  WHERE type_point = 'SIEGE'
  ORDER BY code
  LIMIT 1
)
INSERT INTO pharmacie_fournisseurs
  (code, nom, contact, telephone, ville, conditions_paiement,
   type_fournisseur, point_source_id, actif)
SELECT
  'INT-' || p.code,
  'Pharmacie du Siège (approvisionnement interne)',
  'Direction Pharmacie',
  siege.telephone,
  p.ville,
  'Interne',
  'INTERNE',
  siege.id,
  TRUE
FROM pharmacie_points p
CROSS JOIN siege
WHERE p.type_point = 'SUCCURSALE'
ON CONFLICT (code) DO NOTHING;
