-- =============================================================================
-- GAE - ERP : 46_finance_echeances.sql
-- Gestion des échéances et suivi des engagements financiers.
--
-- Objectif métier :
--   * recenser les OBLIGATIONS (impôts, taxes, cotisations sociales, loyers,
--     salaires, assurances...) et les ENGAGEMENTS financiers (fournisseurs,
--     emprunts, échéances clients...) du groupe ;
--   * suivre pour chacun la date d'échéance, le montant, le bénéficiaire et
--     l'état (à payer / payé / annulé) ;
--   * calculer automatiquement le niveau d'alerte (à venir, proche, du jour,
--     en retard) afin de RAPPELER ces échéances à la DG, la DGA et le Comptable.
--
-- Le « rappel » n'est pas un e-mail : il s'appuie sur le temps réel déjà en
-- place (SSE) et sur un journal de rappels (`finance_echeances_rappels`) qui
-- trace chaque rappel adressé aux destinataires habilités.
--
-- A executer APRES 45_utilisateurs_photos.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Table : finance_echeances
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_echeances (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         VARCHAR(40)  NOT NULL UNIQUE,
  nature         VARCHAR(20)  NOT NULL DEFAULT 'OBLIGATION',
  categorie      VARCHAR(40)  NOT NULL DEFAULT 'AUTRE',
  libelle        VARCHAR(200) NOT NULL,
  description    TEXT,
  beneficiaire   VARCHAR(150),
  montant        NUMERIC(14,2) NOT NULL DEFAULT 0,
  devise         VARCHAR(10)  NOT NULL DEFAULT 'XOF',
  date_echeance  DATE         NOT NULL,
  periodicite    VARCHAR(20)  NOT NULL DEFAULT 'UNIQUE',
  service_id     UUID REFERENCES finance_services(id) ON DELETE SET NULL,
  point_id       UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL,
  compte_id      UUID REFERENCES finance_comptes(id)  ON DELETE SET NULL,
  responsable_id UUID REFERENCES utilisateurs(id)     ON DELETE SET NULL,
  alerte_jours   INTEGER      NOT NULL DEFAULT 7,
  rappel_actif   BOOLEAN      NOT NULL DEFAULT TRUE,
  statut         VARCHAR(20)  NOT NULL DEFAULT 'A_PAYER',
  date_paiement  DATE,
  reference      VARCHAR(80),
  cree_par       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  paye_par       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  paye_le        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_finance_echeances_nature CHECK (nature IN ('OBLIGATION','ENGAGEMENT')),
  CONSTRAINT ck_finance_echeances_categorie CHECK (
    categorie IN ('IMPOT','TAXE','COTISATION_SOCIALE','LOYER','SALAIRE','ASSURANCE',
                  'FOURNISSEUR','EMPRUNT','ECHEANCE_CLIENT','AUTRE')
  ),
  CONSTRAINT ck_finance_echeances_periodicite CHECK (
    periodicite IN ('UNIQUE','MENSUELLE','TRIMESTRIELLE','SEMESTRIELLE','ANNUELLE')
  ),
  CONSTRAINT ck_finance_echeances_statut CHECK (statut IN ('A_PAYER','PAYEE','ANNULEE')),
  CONSTRAINT ck_finance_echeances_alerte CHECK (alerte_jours BETWEEN 0 AND 365)
);

COMMENT ON TABLE finance_echeances IS
  'Obligations (fiscales, sociales, loyers...) et engagements financiers à échéance.';
COMMENT ON COLUMN finance_echeances.nature IS
  'OBLIGATION (échéance récurrente ou légale) ou ENGAGEMENT (engagement financier contractuel).';
COMMENT ON COLUMN finance_echeances.statut IS
  'A_PAYER, PAYEE ou ANNULEE. Le statut « en retard » est calculé selon la date.';

CREATE INDEX IF NOT EXISTS idx_finance_echeances_date    ON finance_echeances(date_echeance);
CREATE INDEX IF NOT EXISTS idx_finance_echeances_statut  ON finance_echeances(statut, date_echeance);
CREATE INDEX IF NOT EXISTS idx_finance_echeances_nature  ON finance_echeances(nature);
CREATE INDEX IF NOT EXISTS idx_finance_echeances_point   ON finance_echeances(point_id);
CREATE INDEX IF NOT EXISTS idx_finance_echeances_service ON finance_echeances(service_id);

-- -----------------------------------------------------------------------------
-- 2. Table : finance_echeances_rappels (journal des rappels)
-- Chaque ligne trace un rappel adressé aux profils de pilotage (DG, DGA,
-- Comptable). Le canal reste « APPLICATION » tant qu'aucun service d'e-mail
-- n'est branché : le rappel est visible dans la cloche de la barre supérieure.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_echeances_rappels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  echeance_id   UUID NOT NULL REFERENCES finance_echeances(id) ON DELETE CASCADE,
  niveau        VARCHAR(20) NOT NULL DEFAULT 'ALERTE',
  canal         VARCHAR(20) NOT NULL DEFAULT 'APPLICATION',
  destinataires VARCHAR(200) NOT NULL DEFAULT 'DG,DGA,COMPTABLE',
  message       TEXT,
  envoye_par    UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  envoye_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_finance_echeances_rappels_niveau CHECK (
    niveau IN ('ALERTE','J_1','JOUR_J','RETARD','MANUEL')
  ),
  CONSTRAINT ck_finance_echeances_rappels_canal CHECK (canal IN ('APPLICATION','EMAIL'))
);

COMMENT ON TABLE finance_echeances_rappels IS
  'Journal des rappels d''échéance adressés à la DG, la DGA et le Comptable.';
CREATE INDEX IF NOT EXISTS idx_finance_echeances_rappels_echeance
  ON finance_echeances_rappels(echeance_id, envoye_le DESC);

-- -----------------------------------------------------------------------------
-- 3. Vue : finance_echeances enrichie (libellés, jours restants, alertes)
-- Le statut effectif et le niveau d'alerte sont calculés à la lecture : aucune
-- tâche planifiée n'est nécessaire pour basculer une échéance « en retard ».
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_finance_echeances AS
SELECT
  e.id, e.numero, e.nature, e.categorie, e.libelle, e.description,
  e.beneficiaire, e.montant, e.devise, e.date_echeance, e.periodicite,
  e.service_id, e.point_id, e.compte_id, e.responsable_id,
  e.alerte_jours, e.rappel_actif, e.statut, e.date_paiement, e.reference,
  e.cree_par, e.paye_par, e.paye_le, e.created_at, e.updated_at,
  s.code  AS service_code,
  s.nom   AS service_nom,
  po.nom  AS point_nom,
  c.prestataire AS compte_prestataire,
  c.numero      AS compte_numero,
  (res.nom || ' ' || res.prenom) AS responsable_nom,
  (cre.nom || ' ' || cre.prenom) AS cree_par_nom,
  (pay.nom || ' ' || pay.prenom) AS paye_par_nom,
  (e.date_echeance - CURRENT_DATE)::INTEGER AS jours_restants,
  CASE
    WHEN e.statut IN ('PAYEE','ANNULEE') THEN e.statut
    WHEN e.date_echeance < CURRENT_DATE THEN 'EN_RETARD'
    ELSE 'A_PAYER'
  END AS statut_effectif,
  CASE
    WHEN e.statut IN ('PAYEE','ANNULEE') THEN 'OK'
    WHEN e.date_echeance < CURRENT_DATE THEN 'RETARD'
    WHEN e.date_echeance = CURRENT_DATE THEN 'JOUR_J'
    WHEN e.date_echeance = CURRENT_DATE + 1 THEN 'J_1'
    WHEN e.date_echeance <= CURRENT_DATE + e.alerte_jours THEN 'ALERTE'
    ELSE 'A_VENIR'
  END AS niveau_alerte
FROM finance_echeances e
LEFT JOIN finance_services  s   ON s.id = e.service_id
LEFT JOIN pharmacie_points  po  ON po.id = e.point_id
LEFT JOIN finance_comptes   c   ON c.id = e.compte_id
LEFT JOIN utilisateurs      res ON res.id = e.responsable_id
LEFT JOIN utilisateurs      cre ON cre.id = e.cree_par
LEFT JOIN utilisateurs      pay ON pay.id = e.paye_par;

COMMENT ON VIEW v_finance_echeances IS
  'Échéances enrichies : libellés, jours restants, statut effectif et niveau d''alerte.';

-- -----------------------------------------------------------------------------
-- 4. Triggers : updated_at + temps réel
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_finance_echeances_maj ON finance_echeances;
CREATE TRIGGER trg_finance_echeances_maj BEFORE UPDATE ON finance_echeances
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();

DO $$
BEGIN
  IF to_regprocedure('fn_notifier_temps_reel()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_temps_reel_finance_echeances ON finance_echeances;
    CREATE TRIGGER trg_temps_reel_finance_echeances
      AFTER INSERT OR UPDATE OR DELETE ON finance_echeances
      FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel('finance.echeances');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Permissions du module Échéances
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('finance.echeances.read',     'finance', 'echeances', 'read',     'Consulter les échéances',   'Lister et consulter les obligations et engagements financiers'),
  ('finance.echeances.create',   'finance', 'echeances', 'create',   'Créer une échéance',        'Enregistrer une obligation ou un engagement financier'),
  ('finance.echeances.update',   'finance', 'echeances', 'update',   'Modifier une échéance',     'Mettre à jour une échéance non encore réglée'),
  ('finance.echeances.validate', 'finance', 'echeances', 'validate', 'Suivre une échéance',       'Marquer une échéance payée, l''annuler ou adresser un rappel')
ON CONFLICT (code) DO NOTHING;

-- Pilotage : la DG, la DGA et le Comptable suivent et rappellent les échéances.
-- La Trésorerie règle et rappelle ; l'Auditeur et le Directeur technique consultent.
WITH attributions (role_code, motif) AS (VALUES
  ('SUPER_ADMIN',   '%'),
  ('DG',            'finance.echeances.%'),
  ('DGA',           'finance.echeances.%'),
  ('COMPTABLE',     'finance.echeances.%'),
  ('TRESORIER',     'finance.echeances.%'),
  ('AUDITEUR',      'finance.echeances.read'),
  ('DIR_TECHNIQUE', 'finance.echeances.read')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code LIKE a.motif
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Jeu de démonstration (idempotent : clé = numero)
--    Dates relatives à aujourd'hui pour illustrer les niveaux d'alerte.
-- -----------------------------------------------------------------------------
INSERT INTO finance_echeances
  (numero, nature, categorie, libelle, description, beneficiaire, montant,
   date_echeance, periodicite, alerte_jours, statut)
VALUES
  ('ECH-SEED-001', 'OBLIGATION', 'IMPOT', 'Impôt sur les bénéfices (acompte)',
   'Acompte trimestriel à verser à la Direction des Impôts.',
   'Direction Générale des Impôts', 750000, CURRENT_DATE + 5, 'TRIMESTRIELLE', 7, 'A_PAYER'),
  ('ECH-SEED-002', 'OBLIGATION', 'COTISATION_SOCIALE', 'Cotisation sociale CNSS',
   'Déclaration et versement des cotisations sociales du mois.',
   'CNSS', 320000, CURRENT_DATE - 3, 'MENSUELLE', 7, 'A_PAYER'),
  ('ECH-SEED-003', 'OBLIGATION', 'LOYER', 'Loyer du siège',
   'Loyer mensuel des locaux du siège.',
   'Propriétaire siège', 450000, CURRENT_DATE + 15, 'MENSUELLE', 10, 'A_PAYER'),
  ('ECH-SEED-004', 'OBLIGATION', 'SALAIRE', 'Salaires du personnel',
   'Virement des salaires du mois en cours.',
   'Personnel du groupe', 2850000, CURRENT_DATE + 10, 'MENSUELLE', 7, 'A_PAYER'),
  ('ECH-SEED-005', 'ENGAGEMENT', 'FOURNISSEUR', 'Facture fournisseur CEVA',
   'Règlement de la facture d''approvisionnement du magasin central.',
   'CEVA Santé Animale', 1250000, CURRENT_DATE + 30, 'UNIQUE', 7, 'A_PAYER')
ON CONFLICT (numero) DO NOTHING;