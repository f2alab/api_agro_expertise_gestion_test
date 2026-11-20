-- =============================================================================
-- GAE - ERP : 44_finance_apports_comptes.sql
-- Fonds de départ et entrées d'argent hors activité opérationnelle.
--
-- Objectif métier :
--   * rattacher une écriture du grand livre à un COMPTE DE PAIEMENT précis
--     (numéro mobile money ou compte bancaire) afin de suivre son solde réel ;
--   * distinguer les FONDS DE DÉPART (dotation initiale d'un compte) des
--     recettes d'exploitation (ventes, consultations, analyses) ;
--   * permettre la saisie d'entrées diverses (apport, subvention, recette
--     exceptionnelle...) qui ne proviennent pas des ventes des pharmacies ni
--     des prestations (consultations / analyses).
--
-- Aucune valeur n'est codée en dur : les comptes restent administrables via
-- l'application (25_finance_comptes_paiement.sql).
-- A exécuter APRES 25_finance_comptes_paiement.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Rattachement des écritures à un compte de paiement
-- -----------------------------------------------------------------------------
ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS compte_id UUID REFERENCES finance_comptes(id) ON DELETE SET NULL;

COMMENT ON COLUMN finance_transactions.compte_id IS
  'Compte de paiement mouvementé (mobile money ou banque), lorsqu''il est connu.';

CREATE INDEX IF NOT EXISTS idx_finance_tx_compte ON finance_transactions(compte_id);

-- -----------------------------------------------------------------------------
-- 2. Nouvelle catégorie : FONDS_DEPART
--    La contrainte d'origine est remplacée pour accepter la dotation initiale.
-- -----------------------------------------------------------------------------
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS ck_finance_tx_categorie;
ALTER TABLE finance_transactions ADD CONSTRAINT ck_finance_tx_categorie CHECK (
  categorie IN ('VENTE','ACHAT','DEPENSE','SALAIRE','TRANSFERT','APPORT',
                'FONDS_DEPART','CONSULTATION','ANALYSE','REMBOURSEMENT','AUTRE')
);

COMMENT ON COLUMN finance_transactions.categorie IS
  'Nature du flux : VENTE, CONSULTATION, ANALYSE, FONDS_DEPART, APPORT, AUTRE...';

-- -----------------------------------------------------------------------------
-- 3. Vue : solde de chaque compte de paiement
--    - fonds_depart  : dotations initiales enregistrées sur le compte ;
--    - total_entrees : toutes les entrées rattachées au compte ;
--    - total_sorties : toutes les sorties rattachées au compte ;
--    - solde         : entrées - sorties.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_finance_solde_compte AS
SELECT
  c.id                                            AS compte_id,
  c.type,
  c.prestataire,
  c.libelle,
  c.numero,
  c.point_id,
  COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' AND t.categorie = 'FONDS_DEPART'
                    THEN t.montant ELSE 0 END), 0) AS fonds_depart,
  COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' THEN t.montant ELSE 0 END), 0) AS total_entrees,
  COALESCE(SUM(CASE WHEN t.sens = 'SORTIE' THEN t.montant ELSE 0 END), 0) AS total_sorties,
  COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' THEN t.montant ELSE -t.montant END), 0) AS solde,
  count(t.id)::INTEGER                            AS nb_mouvements
FROM finance_comptes c
LEFT JOIN finance_transactions t ON t.compte_id = c.id
GROUP BY c.id, c.type, c.prestataire, c.libelle, c.numero, c.point_id;

COMMENT ON VIEW v_finance_solde_compte IS
  'Fonds de départ, entrées, sorties et solde de chaque compte de paiement.';

-- -----------------------------------------------------------------------------
-- 4. Service « Finance groupe » : rattachement par défaut des entrées/sorties
--    qui ne concernent ni une pharmacie ni une activité (apport, subvention,
--    recette diverse...). Le grand livre exige un service : celui-ci évite de
--    forcer l'utilisateur à choisir un service ou une pharmacie.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_finance_service_groupe()
RETURNS UUID AS $$
DECLARE
  v_service_id UUID;
BEGIN
  SELECT id INTO v_service_id FROM finance_services WHERE code = 'FIN-GROUPE';
  IF v_service_id IS NOT NULL THEN
    RETURN v_service_id;
  END IF;

  INSERT INTO finance_services (code, nom, type_service, description)
  VALUES ('FIN-GROUPE', 'Finance groupe', 'AUTRE',
          'Entrées et sorties non rattachées à une pharmacie ou à une activité')
  ON CONFLICT (code) DO NOTHING
  RETURNING id INTO v_service_id;

  IF v_service_id IS NULL THEN
    SELECT id INTO v_service_id FROM finance_services WHERE code = 'FIN-GROUPE';
  END IF;

  RETURN v_service_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_finance_service_groupe() IS
  'Renvoie (et crée au besoin) le service financier par défaut des entrées hors activité.';

-- Création immédiate : le service apparaît dans les listes et les rapports.
SELECT fn_finance_service_groupe();

-- -----------------------------------------------------------------------------
-- 5. Droits de saisie : la direction peut enregistrer un fonds de départ
--    (les rôles Comptable / Trésorier disposent déjà de finance.transactions.create).
-- -----------------------------------------------------------------------------
WITH attributions (role_code) AS (VALUES
  ('DG'), ('DGA'), ('DIR_TECHNIQUE')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r ON r.code = a.role_code
JOIN permissions p ON p.code = 'finance.transactions.create'
ON CONFLICT DO NOTHING;