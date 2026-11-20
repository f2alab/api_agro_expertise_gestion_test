-- =============================================================================
-- GAE - ERP : 37_rapports_depenses_approuvees.sql
-- Situation / PV : les depenses sont datees par leur DATE D'APPROBATION.
--   * la section « depenses » du rapport utilise `finance_depenses.valide_le`
--     (et non `date_depense`, qui est la date saisie) : une depense simplement
--     soumise pour approbation (`EN_ATTENTE`) n'entre donc jamais dans les
--     totaux ni dans les sorties de la periode ;
--   * index d'aide a ce filtre (point de vente + date d'approbation).
-- A executer APRES 36_affichage_discret.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Index : rapport de caisse (par point de vente, depenses approuvees les plus
-- recentes d'abord). Remplace l'ancien index sur la date saisie de la depense
-- pour ce type de lecture.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_finance_depenses_point_valide_le
ON finance_depenses (point_id, valide_le DESC)
WHERE statut = 'VALIDEE';

COMMENT ON COLUMN finance_depenses.valide_le IS
  'Date et heure d''approbation de la depense : retenue par les rapports (une depense en attente n''est jamais comptee).';
