-- =============================================================================
-- GAE - ERP : 26_ventes_credit.sql
-- Ventes a credit (paiement partiel) et rendu de monnaie.
--   * montant_recu  : somme remise par le client au comptoir ;
--   * montant_rendu : monnaie rendue (montant_recu - montant encaisse) ;
--   * total_paye    : cumul des encaissements (maintenu par trigger) ;
--   * reste_a_payer : total_ttc - total_paye (creance du client).
-- A executer APRES 25_finance_comptes_paiement.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

ALTER TABLE pharmacie_ventes
  ADD COLUMN IF NOT EXISTS montant_recu  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS montant_rendu NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS total_paye    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reste_a_payer NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN pharmacie_ventes.montant_recu  IS 'Montant remis par le client au comptoir.';
COMMENT ON COLUMN pharmacie_ventes.montant_rendu IS 'Monnaie rendue au client.';
COMMENT ON COLUMN pharmacie_ventes.total_paye    IS 'Cumul des encaissements (trigger sur pharmacie_paiements).';
COMMENT ON COLUMN pharmacie_ventes.reste_a_payer IS 'Creance restante du client sur cette vente.';

-- -----------------------------------------------------------------------------
-- Reprise des donnees existantes
-- -----------------------------------------------------------------------------
UPDATE pharmacie_ventes v
SET total_paye = COALESCE(agg.somme, 0)
FROM (
  SELECT vente_id, SUM(montant) AS somme FROM pharmacie_paiements GROUP BY vente_id
) agg
WHERE agg.vente_id = v.id;

UPDATE pharmacie_ventes
SET reste_a_payer = GREATEST(total_ttc - total_paye, 0);

-- -----------------------------------------------------------------------------
-- Synchronisation automatique : tout encaissement (creation, modification,
-- suppression) recalcule le total paye et le reste du de la vente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pharmacie_vente_maj_paiements() RETURNS TRIGGER AS $$
DECLARE
  v_vente UUID;
  v_somme NUMERIC(14,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_vente := OLD.vente_id;
  ELSE
    v_vente := NEW.vente_id;
  END IF;

  SELECT COALESCE(SUM(montant), 0) INTO v_somme
  FROM pharmacie_paiements WHERE vente_id = v_vente;

  UPDATE pharmacie_ventes
  SET total_paye = v_somme,
      reste_a_payer = GREATEST(total_ttc - v_somme, 0)
  WHERE id = v_vente;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pharmacie_paiements_maj_vente ON pharmacie_paiements;
CREATE TRIGGER trg_pharmacie_paiements_maj_vente
  AFTER INSERT OR UPDATE OR DELETE ON pharmacie_paiements
  FOR EACH ROW EXECUTE FUNCTION fn_pharmacie_vente_maj_paiements();

-- Recherche rapide des ventes non soldees (creances clients).
CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_reste
  ON pharmacie_ventes(reste_a_payer) WHERE reste_a_payer > 0;
CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_client
  ON pharmacie_ventes(client_id);