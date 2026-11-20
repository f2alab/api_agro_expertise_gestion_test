-- =============================================================================
-- GAE - ERP : 30_suppression_client_denormalise.sql
-- Supprime la duplication des informations client sur la vente.
-- Apres cette migration, la SEULE source de verite du client est la fiche
-- `pharmacie_clients`, referencee par `pharmacie_ventes.client_id`.
--   * les colonnes `client_nom` / `client_contact` sont supprimees ;
--   * les ventes qui ne portaient qu'un texte libre sont rattachees a une
--     fiche client (reprise defensive, sans effet sur une base neuve).
-- A executer APRES 29_retours_ventes.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Reprise defensive : transformer les anciennes ventes "texte libre" en fiche
-- client, afin de ne perdre aucune information avant la suppression des
-- colonnes. Le bloc ne s'execute que si les colonnes existent encore.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r        RECORD;
  v_client UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacie_ventes' AND column_name = 'client_nom'
  ) THEN
    FOR r IN
      SELECT id, point_id, client_nom, client_contact
      FROM pharmacie_ventes
      WHERE client_id IS NULL AND client_nom IS NOT NULL AND btrim(client_nom) <> ''
    LOOP
      INSERT INTO pharmacie_clients (nom, telephone, point_id)
      VALUES (btrim(r.client_nom), NULLIF(btrim(r.client_contact), ''), r.point_id)
      RETURNING id INTO v_client;

      UPDATE pharmacie_ventes SET client_id = v_client WHERE id = r.id;
    END LOOP;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Suppression des colonnes denormalisees
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_ventes DROP COLUMN IF EXISTS client_nom;
ALTER TABLE pharmacie_ventes DROP COLUMN IF EXISTS client_contact;

COMMENT ON COLUMN pharmacie_ventes.client_id IS
  'Client de la vente (pharmacie_clients). NULL = vente au comptoir sans client identifie.';