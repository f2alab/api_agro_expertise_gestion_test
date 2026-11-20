-- =============================================================================
-- GAE - ERP : 19_temps_reel_finances.sql
-- Temps réel pour les tables du module Finance (grand livre, services, dépenses).
-- Réutilise fn_notifier_temps_reel() définie dans 13_temps_reel.sql.
-- A exécuter APRÈS 18_finances_seed.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

DO $$
DECLARE
  association RECORD;
  nom_trigger TEXT;
BEGIN
  FOR association IN
    SELECT * FROM (VALUES
      ('finance_services',     'finance.services'),
      ('finance_transactions', 'finance.transactions'),
      ('finance_depenses',     'finance.depenses')
    ) AS t(table_cible, type_evenement)
  LOOP
    IF to_regclass(association.table_cible) IS NULL THEN
      RAISE NOTICE 'Table % absente : temps réel non configuré pour elle.', association.table_cible;
      CONTINUE;
    END IF;

    nom_trigger := 'trg_temps_reel_' || left(association.table_cible, 45);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', nom_trigger, association.table_cible);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel(%L)',
      nom_trigger, association.table_cible, association.type_evenement
    );
  END LOOP;
END $$;
