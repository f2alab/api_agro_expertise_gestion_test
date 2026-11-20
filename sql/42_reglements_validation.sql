-- 42_reglements_validation.sql
-- Validation des reglements fournisseurs (demandes de paiement).
--
-- Un reglement n'est plus ecrit au grand livre des sa saisie : il devient une
-- *demande* (EN_ATTENTE) que l'administration (DG, DGA, Comptable...) approuve.
-- L'ecriture de tresorerie SORTIE / ACHAT n'est creee qu'a la validation, et son
-- identifiant est conserve (`transaction_id`) pour la reconciliation.
--
-- Reprise : les reglements deja enregistres ont deja leur ecriture -> VALIDE.
--
-- Script rejouable (idempotent).

ALTER TABLE pharmacie_reglements
  ADD COLUMN IF NOT EXISTS statut         VARCHAR(20) NOT NULL DEFAULT 'VALIDE',
  ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valide_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valide_le      TIMESTAMPTZ;

-- Les prochains reglements sont des demandes a valider.
ALTER TABLE pharmacie_reglements ALTER COLUMN statut SET DEFAULT 'EN_ATTENTE';

ALTER TABLE pharmacie_reglements DROP CONSTRAINT IF EXISTS ck_pharmacie_reglement_statut;
ALTER TABLE pharmacie_reglements ADD CONSTRAINT ck_pharmacie_reglement_statut
  CHECK (statut IN ('EN_ATTENTE', 'VALIDE', 'REJETE'));

-- File d'attente des validations (tableau de bord de l'administration).
CREATE INDEX IF NOT EXISTS idx_pharmacie_reglements_statut
  ON pharmacie_reglements(statut, date_reglement);