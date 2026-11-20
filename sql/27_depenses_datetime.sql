-- =============================================================================
-- GAE - ERP : 27_depenses_datetime.sql
-- La date d'une dépense devient un horodatage complet (date + heure) au lieu
-- d'une simple date. La tracabilite complete de la depense est ainsi assuree :
--   * created_at  -> date-heure de soumission (deja TIMESTAMPTZ) ;
--   * date_depense-> date-heure de la depense (desormais TIMESTAMPTZ) ;
--   * valide_le   -> date-heure d'approbation (deja TIMESTAMPTZ).
-- Aucune valeur codee en dur ; toutes les dates restent saisissables et
-- modifiables depuis l'application.
-- A executer APRES 26_ventes_credit.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- 1. Conversion de date_depense : DATE -> TIMESTAMPTZ ------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'finance_depenses'
      AND column_name  = 'date_depense'
      AND data_type    = 'date'
  ) THEN
    ALTER TABLE finance_depenses
      ALTER COLUMN date_depense TYPE TIMESTAMPTZ
      USING date_depense::timestamptz;
  END IF;
END $$;

-- 2. Valeur par defaut : instant courant (date + heure) ----------------------
ALTER TABLE finance_depenses
  ALTER COLUMN date_depense SET DEFAULT now();

COMMENT ON COLUMN finance_depenses.date_depense IS 'Date et heure de la dépense (horodatage complet).';
