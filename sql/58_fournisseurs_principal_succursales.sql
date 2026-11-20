-- =============================================================================
-- GAE - ERP : 58_fournisseurs_principal_succursales.sql
-- Fournisseur principal « Pharmacie du Siège » de chaque succursale.
--
-- Regles metier :
--   * chaque SUCCURSALE recoit AUTOMATIQUEMENT le fournisseur interne
--     « Pharmacie du Siège » (code INT-<code pharmacie>) ;
--   * ce fournisseur est son fournisseur PRINCIPAL (`principal = TRUE`) et il
--     ne peut pas etre desactive (regle appliquee par l'API) ;
--   * la pharmacie du siege et le magasin central n'ont PAS de fournisseur
--     principal : le siege commande aux firmes, le magasin ravitaille par
--     transfert ;
--   * chaque succursale peut ensuite ajouter ses propres fournisseurs,
--     independamment des autres (cloisonnement par pharmacie_fournisseurs.point_id).
--
-- A executer APRES 57_roles_veterinaires.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Marqueur « fournisseur principal » (un seul par pharmacie).
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_fournisseurs
  ADD COLUMN IF NOT EXISTS principal BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN pharmacie_fournisseurs.principal IS
  'Fournisseur principal de la pharmacie (approvisionnement interne : Pharmacie du Siege).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_pharmacie_fournisseurs_principal
  ON pharmacie_fournisseurs(point_id)
  WHERE principal;

-- -----------------------------------------------------------------------------
-- 2. Reprise : les fournisseurs INTERNES sont rattaches a leur pharmacie.
--    (Corrige aussi les lignes creees apres le script 20, comme
--    INT-PH-PRINCIPE dont point_id etait reste NULL.)
-- -----------------------------------------------------------------------------
UPDATE pharmacie_fournisseurs f
SET point_id = p.id
FROM pharmacie_points p
WHERE f.point_id IS NULL
  AND f.type_fournisseur = 'INTERNE'
  AND f.code = 'INT-' || p.code;

-- -----------------------------------------------------------------------------
-- 3. Le fournisseur principal n'a de sens que pour une SUCCURSALE (c'est elle
--    qui s'approvisionne aupres du siege). On retire donc le marqueur des
--    autres lignes (pharmacie du siege, magasin central).
-- -----------------------------------------------------------------------------
UPDATE pharmacie_fournisseurs f
SET principal = FALSE
WHERE f.principal
  AND NOT (
    f.type_fournisseur = 'INTERNE'
    AND f.point_id IS NOT NULL
    AND f.code = 'INT-' || (SELECT p.code FROM pharmacie_points p WHERE p.id = f.point_id)
    AND EXISTS (
      SELECT 1 FROM pharmacie_points p
      WHERE p.id = f.point_id AND p.type_point = 'SUCCURSALE'
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Les lignes INTERNE rattachees au siege ou au magasin ne sont pas des
--    fournisseurs (le siege commande aux firmes, le magasin ravitaille par
--    transfert) : on les supprime si elles n'ont jamais servi, sinon on les
--    desactive pour conserver l'historique des commandes.
-- -----------------------------------------------------------------------------
DELETE FROM pharmacie_fournisseurs f
WHERE f.type_fournisseur = 'INTERNE'
  AND f.point_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pharmacie_points p
    WHERE p.id = f.point_id AND p.type_point <> 'SUCCURSALE'
  )
  AND NOT EXISTS (SELECT 1 FROM pharmacie_commandes c WHERE c.fournisseur_id = f.id);

UPDATE pharmacie_fournisseurs f
SET principal = FALSE, actif = FALSE
WHERE f.type_fournisseur = 'INTERNE'
  AND f.point_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pharmacie_points p
    WHERE p.id = f.point_id AND p.type_point <> 'SUCCURSALE'
  );

-- -----------------------------------------------------------------------------
-- 5. Normalisation du fournisseur interne des SUCCURSALES : nom « Pharmacie du
--    Siège », source = magasin central du siege (sinon la pharmacie du siege)
--    et marqueur principal.
-- -----------------------------------------------------------------------------
UPDATE pharmacie_fournisseurs f
SET nom             = 'Pharmacie du Siège',
    principal       = TRUE,
    actif           = TRUE,
    point_source_id = COALESCE(
      (SELECT id FROM pharmacie_points WHERE code = 'MAG-PRINCIPE'),
      (SELECT id FROM pharmacie_points WHERE type_point = 'SIEGE' ORDER BY code LIMIT 1)
    )
WHERE f.type_fournisseur = 'INTERNE'
  AND f.point_id IS NOT NULL
  AND f.code = 'INT-' || (SELECT p.code FROM pharmacie_points p WHERE p.id = f.point_id)
  AND EXISTS (
    SELECT 1 FROM pharmacie_points p
    WHERE p.id = f.point_id AND p.type_point = 'SUCCURSALE'
  );

-- -----------------------------------------------------------------------------
-- 6. Creation automatique du fournisseur principal de chaque succursale
--    (les autres points n'en recoivent pas).
-- -----------------------------------------------------------------------------
INSERT INTO pharmacie_fournisseurs
  (code, nom, contact, telephone, ville, conditions_paiement, delai_livraison_jours,
   type_fournisseur, point_source_id, point_id, principal, actif)
SELECT
  'INT-' || p.code,
  'Pharmacie du Siège',
  'Direction Pharmacie',
  source.telephone,
  p.ville,
  'Interne',
  0,
  'INTERNE',
  source.id,
  p.id,
  TRUE,
  TRUE
FROM pharmacie_points p
CROSS JOIN LATERAL (
  SELECT s.id, s.telephone
  FROM pharmacie_points s
  WHERE s.actif
    AND (s.code = 'MAG-PRINCIPE' OR s.type_point = 'SIEGE')
  ORDER BY CASE WHEN s.code = 'MAG-PRINCIPE' THEN 0 ELSE 1 END
  LIMIT 1
) source
WHERE p.type_point = 'SUCCURSALE'
  AND p.actif
ON CONFLICT (code) DO UPDATE
  SET nom             = EXCLUDED.nom,
      type_fournisseur = 'INTERNE',
      point_source_id  = EXCLUDED.point_source_id,
      point_id         = EXCLUDED.point_id,
      principal        = TRUE,
      actif            = TRUE;

-- -----------------------------------------------------------------------------
-- 7. Controle de coherence : chaque succursale active possede exactement un
--    fournisseur principal INTERNE (visible dans le journal du script).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  manquantes INTEGER;
BEGIN
  SELECT count(*) INTO manquantes
  FROM pharmacie_points p
  WHERE p.actif
    AND p.type_point = 'SUCCURSALE'
    AND NOT EXISTS (
      SELECT 1
      FROM pharmacie_fournisseurs f
      WHERE f.point_id = p.id
        AND f.principal
        AND f.type_fournisseur = 'INTERNE'
    );

  IF manquantes > 0 THEN
    RAISE WARNING '% succursale(s) sans fournisseur principal.', manquantes;
  ELSE
    RAISE NOTICE 'Fournisseur principal present pour toutes les succursales actives.';
  END IF;
END $$;