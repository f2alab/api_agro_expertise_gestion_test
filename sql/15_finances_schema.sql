-- =============================================================================
-- GAE - ERP : 15_finances_schema.sql
-- Module Finance (transversal) : base financière UNIQUE et centralisée pour
-- toutes les activités du Groupe Agro-Expertise (pharmacies du siège et
-- succursales, consultation clinique, analyse biochimique, ...).
--
-- Principe :
--   * finance_services     -> registre unifié des "centres de flux". Chaque
--                             pharmacie (point de vente) et chaque activité
--                             (consultation, analyse...) y est déclarée.
--   * finance_transactions -> GRAND LIVRE unique : toute entrée/sortie d'argent
--                             (vente, achat, dépense, apport, transfert...) est
--                             enregistrée ici, quel que soit le module d'origine.
--                             Chaque écriture est traçable : qui, depuis quel
--                             service, par quel moyen, à quelle date-heure.
--   * finance_depenses     -> dépenses structurées d'un service ; leur
--                             validation génère une écriture au grand livre.
--
-- A exécuter APRES 14_performance.sql (dépend de pharmacie_points, departements,
-- utilisateurs, pharmacie_fournisseurs).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Table : finance_services (registre unifié des centres de flux)
-- Un service est soit une pharmacie (point de vente), soit une activité du
-- groupe (consultation clinique, analyse biochimique, hospitalisation...).
-- Le rapprochement "par pharmacie" se fait via point_id ; le rapprochement
-- "par activité" via departement_id.
-- -----------------------------------------------------------------------------
CREATE TABLE finance_services (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(60)  NOT NULL UNIQUE,
  nom            VARCHAR(150) NOT NULL,
  type_service   VARCHAR(30)  NOT NULL DEFAULT 'AUTRE',
  point_id       UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL,
  departement_id UUID REFERENCES departements(id)     ON DELETE SET NULL,
  description    TEXT,
  actif          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_finance_services_type CHECK (
    type_service IN ('PHARMACIE','CONSULTATION','ANALYSE','LABORATOIRE','HOSPITALISATION','AUTRE')
  )
);

COMMENT ON TABLE  finance_services IS 'Registre unifié des services/activités générant des flux financiers.';
COMMENT ON COLUMN finance_services.point_id IS 'Pharmacie (point de vente) lorsque le service est une pharmacie.';
COMMENT ON COLUMN finance_services.departement_id IS 'Rattachement organigramme (activités cliniques, laboratoire...).';

-- Une seule ligne de service par pharmacie.
CREATE UNIQUE INDEX uq_finance_services_point ON finance_services(point_id) WHERE point_id IS NOT NULL;
CREATE INDEX idx_finance_services_type ON finance_services(type_service);
CREATE INDEX idx_finance_services_departement ON finance_services(departement_id);

-- -----------------------------------------------------------------------------
-- Table : finance_transactions (grand livre unique)
-- Toute circulation d'argent est écrite ici. Les colonnes de traçabilité
-- (effectue_par, service_id, mode, date_transaction) répondent à l'exigence
-- "qui a fait quoi, depuis quel service, par quel moyen, quand".
-- -----------------------------------------------------------------------------
CREATE TABLE finance_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           VARCHAR(40) NOT NULL UNIQUE,
  service_id       UUID NOT NULL REFERENCES finance_services(id) ON DELETE RESTRICT,
  point_id         UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL,
  sens             VARCHAR(10) NOT NULL,
  categorie        VARCHAR(30) NOT NULL DEFAULT 'AUTRE',
  mode             VARCHAR(20) NOT NULL DEFAULT 'ESPECES',
  montant          NUMERIC(14,2) NOT NULL DEFAULT 0,
  libelle          VARCHAR(200),
  reference_type   VARCHAR(40),
  reference_id     UUID,
  effectue_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_transaction TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_finance_tx_sens CHECK (sens IN ('ENTREE','SORTIE')),
  CONSTRAINT ck_finance_tx_mode CHECK (
    mode IN ('ESPECES','MOBILE_MONEY','CHEQUE','VIREMENT','CARTE','CREDIT')
  ),
  CONSTRAINT ck_finance_tx_categorie CHECK (
    categorie IN ('VENTE','ACHAT','DEPENSE','SALAIRE','TRANSFERT','APPORT',
                  'CONSULTATION','ANALYSE','REMBOURSEMENT','AUTRE')
  )
);

COMMENT ON TABLE finance_transactions IS 'Grand livre unique : toutes les entrées/sorties d''argent du groupe.';

CREATE INDEX idx_finance_tx_date ON finance_transactions(date_transaction DESC);
CREATE INDEX idx_finance_tx_service ON finance_transactions(service_id);
CREATE INDEX idx_finance_tx_point ON finance_transactions(point_id);
CREATE INDEX idx_finance_tx_categorie ON finance_transactions(categorie);
CREATE INDEX idx_finance_tx_reference ON finance_transactions(reference_type, reference_id);


-- -----------------------------------------------------------------------------
-- Table : finance_depenses (dépenses structurées d'un service)
-- La validation d'une dépense crée une écriture de sortie au grand livre.
-- -----------------------------------------------------------------------------
CREATE TABLE finance_depenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         VARCHAR(40) NOT NULL UNIQUE,
  service_id     UUID NOT NULL REFERENCES finance_services(id) ON DELETE RESTRICT,
  point_id       UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL,
  categorie      VARCHAR(60) NOT NULL DEFAULT 'DIVERS',
  libelle        VARCHAR(200) NOT NULL,
  beneficiaire   VARCHAR(150),
  fournisseur_id UUID REFERENCES pharmacie_fournisseurs(id) ON DELETE SET NULL,
  montant        NUMERIC(14,2) NOT NULL DEFAULT 0,
  mode           VARCHAR(20) NOT NULL DEFAULT 'ESPECES',
  reference      VARCHAR(80),
  statut         VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
  date_depense   DATE NOT NULL DEFAULT CURRENT_DATE,
  commentaire    TEXT,
  cree_par       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_le      TIMESTAMPTZ,
  transaction_id UUID REFERENCES finance_transactions(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_finance_depense_statut CHECK (statut IN ('EN_ATTENTE','VALIDEE','ANNULEE')),
  CONSTRAINT ck_finance_depense_mode CHECK (
    mode IN ('ESPECES','MOBILE_MONEY','CHEQUE','VIREMENT','CARTE','CREDIT')
  )
);

COMMENT ON TABLE finance_depenses IS 'Dépenses d''un service (pharmacie ou activité) ; validées = écriture au grand livre.';

CREATE INDEX idx_finance_depenses_service ON finance_depenses(service_id);
CREATE INDEX idx_finance_depenses_point ON finance_depenses(point_id);
CREATE INDEX idx_finance_depenses_statut ON finance_depenses(statut, date_depense DESC);

-- -----------------------------------------------------------------------------
-- Vues d'analyse
-- -----------------------------------------------------------------------------

-- Synthèse par service : entrées, sorties, solde et activité.
CREATE OR REPLACE VIEW v_finance_par_service AS
SELECT
  s.id                                              AS service_id,
  s.code                                            AS service_code,
  s.nom                                             AS service_nom,
  s.type_service,
  s.point_id,
  po.nom                                            AS point_nom,
  COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' THEN t.montant ELSE 0 END), 0) AS total_entrees,
  COALESCE(SUM(CASE WHEN t.sens = 'SORTIE' THEN t.montant ELSE 0 END), 0) AS total_sorties,
  COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' THEN t.montant ELSE -t.montant END), 0) AS solde,
  count(t.id)::INTEGER                              AS nb_transactions
FROM finance_services s
LEFT JOIN pharmacie_points po ON po.id = s.point_id
LEFT JOIN finance_transactions t ON t.service_id = s.id
GROUP BY s.id, s.code, s.nom, s.type_service, s.point_id, po.nom;

COMMENT ON VIEW v_finance_par_service IS 'Synthèse financière (entrées, sorties, solde) par service.';

-- Synthèse par mode de paiement (espèces, mobile money, chèque, virement...).
CREATE OR REPLACE VIEW v_finance_par_mode AS
SELECT
  mode,
  COALESCE(SUM(CASE WHEN sens = 'ENTREE' THEN montant ELSE 0 END), 0) AS total_entrees,
  COALESCE(SUM(CASE WHEN sens = 'SORTIE' THEN montant ELSE 0 END), 0) AS total_sorties,
  count(*)::INTEGER AS nb_transactions
FROM finance_transactions
GROUP BY mode;

COMMENT ON VIEW v_finance_par_mode IS 'Répartition des flux par moyen de paiement.';

-- -----------------------------------------------------------------------------
-- Fonction : identifiant du service financier d'une pharmacie.
-- Crée la ligne de service si elle n'existe pas encore (robustesse).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_finance_service_point(p_point_id UUID)
RETURNS UUID AS $$
DECLARE
  v_service_id UUID;
BEGIN
  SELECT id INTO v_service_id FROM finance_services WHERE point_id = p_point_id;
  IF v_service_id IS NOT NULL THEN
    RETURN v_service_id;
  END IF;

  INSERT INTO finance_services (code, nom, type_service, point_id)
  SELECT p.code, p.nom, 'PHARMACIE', p.id
  FROM pharmacie_points p
  WHERE p.id = p_point_id
  RETURNING id INTO v_service_id;

  RETURN v_service_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_finance_service_point(UUID) IS 'Renvoie (et crée au besoin) le service financier d''une pharmacie.';

-- Provisionnement automatique : chaque nouvelle pharmacie reçoit son service.
CREATE OR REPLACE FUNCTION fn_finance_service_point_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM fn_finance_service_point(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finance_service_point ON pharmacie_points;
CREATE TRIGGER trg_finance_service_point
  AFTER INSERT ON pharmacie_points
  FOR EACH ROW EXECUTE FUNCTION fn_finance_service_point_trigger();

-- Reprise des pharmacies existantes.
SELECT fn_finance_service_point(id) FROM pharmacie_points WHERE actif;

-- -----------------------------------------------------------------------------
-- Triggers : mise à jour automatique de updated_at
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_finance_services_maj ON finance_services;
CREATE TRIGGER trg_finance_services_maj BEFORE UPDATE ON finance_services
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();

DROP TRIGGER IF EXISTS trg_finance_depenses_maj ON finance_depenses;
CREATE TRIGGER trg_finance_depenses_maj BEFORE UPDATE ON finance_depenses
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
