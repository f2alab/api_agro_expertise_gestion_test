-- =============================================================================
-- GAE - ERP : 47_clinique_schema.sql
-- Module Clinique vétérinaire : structure de la base de données.
--   * référentiels (espèces, races, motifs, organes, examens paracliniques) ;
--   * propriétaires et animaux (dossier médical permanent) ;
--   * consultations (accueil, frais, workflow de prise en charge) ;
--   * examens cliniques (à distance / rapproché) + examen organe par organe ;
--   * diagnostics, examens paracliniques (imagerie, radio, écho, labo) ;
--   * ordonnances (liées aux produits de la pharmacie) ;
--   * factures globales (lignes par rubrique, inclusion paramétrable).
-- A executer APRES 46_finance_echeances.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Compteurs de numérotation : un compteur par (préfixe, année).
-- La fonction produit les numéros lisibles du module :
--   fn_clinique_numero('CONS', 2026) -> CONS-2026-000123
--   fn_clinique_numero('PROP')       -> PROP-000001
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_compteurs (
  prefixe VARCHAR(10) NOT NULL,
  annee   SMALLINT    NOT NULL DEFAULT 0,
  dernier INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (prefixe, annee)
);

CREATE OR REPLACE FUNCTION fn_clinique_numero(
  p_prefixe  VARCHAR,
  p_annee    INTEGER  DEFAULT NULL,
  p_longueur SMALLINT DEFAULT 6
) RETURNS TEXT AS $$
DECLARE
  v_annee SMALLINT := COALESCE(p_annee, 0)::SMALLINT;
  v_num   INTEGER;
  v_debut TEXT;
BEGIN
  INSERT INTO clinique_compteurs (prefixe, annee, dernier)
  VALUES (p_prefixe, v_annee, 1)
  ON CONFLICT (prefixe, annee)
    DO UPDATE SET dernier = clinique_compteurs.dernier + 1
  RETURNING dernier INTO v_num;

  v_debut := p_prefixe || CASE WHEN p_annee IS NULL THEN '' ELSE '-' || p_annee END || '-';
  RETURN v_debut || lpad(v_num::text, p_longueur, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_clinique_numero(VARCHAR, INTEGER, SMALLINT)
  IS 'Numéro séquentiel du module clinique (ex. CONS-2026-000123, PROP-000001).';

-- -----------------------------------------------------------------------------
-- Table : clinique_referentiels
-- Nomenclatures paramétrables du module (type + code + libellé). Le parent
-- permet de rattacher une race à une espèce, un motif à une famille...
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_referentiels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       VARCHAR(40)  NOT NULL,          -- ESPECE, RACE, MOTIF, ORGANE, EXAMEN_PARACLINIQUE
  code       VARCHAR(60)  NOT NULL,
  libelle    VARCHAR(150) NOT NULL,
  parent_id  UUID REFERENCES clinique_referentiels(id) ON DELETE SET NULL,
  ordre      SMALLINT     NOT NULL DEFAULT 0,
  actif      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_clinique_referentiels UNIQUE (type, code)
);

COMMENT ON TABLE clinique_referentiels IS 'Nomenclatures du module clinique (espèces, races, motifs, organes, examens).';

CREATE INDEX idx_clinique_referentiels_type ON clinique_referentiels(type);

-- -----------------------------------------------------------------------------
-- Table : clinique_proprietaires
-- Client de la clinique (particulier, éleveur, entreprise, état...).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_proprietaires (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 VARCHAR(30)  NOT NULL UNIQUE,      -- PROP-000001
  nom                  VARCHAR(150) NOT NULL,
  telephone            VARCHAR(30),
  telephone_secondaire VARCHAR(30),
  email                VARCHAR(180),
  adresse              VARCHAR(200),
  ville                VARCHAR(120),
  type_proprietaire    VARCHAR(20)  NOT NULL DEFAULT 'PARTICULIER',
  actif                BOOLEAN      NOT NULL DEFAULT TRUE,
  notes                TEXT,
  cree_par             UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_prop_type CHECK (
    type_proprietaire IN ('PARTICULIER','ELEVEUR','ENTREPRISE','ETAT','ONG','AUTRE')
  )
);

COMMENT ON TABLE clinique_proprietaires IS 'Propriétaires d''animaux suivis par la clinique vétérinaire.';

CREATE INDEX idx_clinique_proprietaires_nom ON clinique_proprietaires(nom);

-- -----------------------------------------------------------------------------
-- Table : clinique_animaux
-- Fiche permanente de l'animal : tout passage à la clinique alimente son
-- dossier médical (consultations, diagnostics, ordonnances, factures).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_animaux (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR(30)  NOT NULL UNIQUE,       -- ANI-000001
  proprietaire_id     UUID         NOT NULL REFERENCES clinique_proprietaires(id) ON DELETE CASCADE,
  nom                 VARCHAR(120),
  espece              VARCHAR(80)  NOT NULL,
  race                VARCHAR(80),
  sexe                VARCHAR(10)  NOT NULL DEFAULT 'INCONNU',
  date_naissance      DATE,
  age_estime          VARCHAR(40),
  poids_kg            NUMERIC(8,3),
  robe                VARCHAR(80),
  identification      VARCHAR(120),                       -- puce, boucle, tatouage
  signes_particuliers TEXT,
  statut              VARCHAR(20)  NOT NULL DEFAULT 'VIVANT',
  cree_par            UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_animal_sexe CHECK (sexe IN ('M','F','INCONNU')),
  CONSTRAINT ck_clinique_animal_statut CHECK (statut IN ('VIVANT','MORT','DEPLACE','ABANDONNE'))
);

COMMENT ON TABLE clinique_animaux IS 'Animaux suivis par la clinique (dossier médical permanent).';

CREATE INDEX idx_clinique_animaux_proprietaire ON clinique_animaux(proprietaire_id);
CREATE INDEX idx_clinique_animaux_espece ON clinique_animaux(espece);

-- -----------------------------------------------------------------------------
-- Table : clinique_consultations
-- Entête d'un passage à la clinique : accueil (motif, frais encaissés) puis
-- prise en charge médicale. Le montant des frais est FIGÉ à l'enregistrement :
-- modifier le tarif en cours d'année n'altère jamais l'historique.
-- Workflow : ACCUEIL -> EN_ATTENTE_PAIEMENT -> EN_CONSULTATION ->
--            EXAMEN_PARACLINIQUE -> RESULTATS -> ORDONNANCE -> CLOTURE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_consultations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               VARCHAR(30)  NOT NULL UNIQUE,      -- CONS-2026-000123
  animal_id            UUID         NOT NULL REFERENCES clinique_animaux(id) ON DELETE RESTRICT,
  proprietaire_id      UUID         NOT NULL REFERENCES clinique_proprietaires(id) ON DELETE RESTRICT,
  motif                VARCHAR(300) NOT NULL,
  motif_referentiel_id UUID REFERENCES clinique_referentiels(id) ON DELETE SET NULL,
  type_consultation    VARCHAR(30)  NOT NULL DEFAULT 'CONSULTATION',
  statut               VARCHAR(40)  NOT NULL DEFAULT 'ACCUEIL',
  -- Frais de consultation (montant appliqué + encaissement à l'accueil)
  frais_consultation   NUMERIC(12,2) NOT NULL DEFAULT 0,
  frais_payes          BOOLEAN      NOT NULL DEFAULT FALSE,
  montant_frais_paye   NUMERIC(12,2) NOT NULL DEFAULT 0,
  mode_paiement_frais  VARCHAR(20),
  reference_paiement   VARCHAR(80),
  -- Personnel et chronologie
  accueil_par          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  accueil_le           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  veterinaire_id       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  consultation_debut   TIMESTAMPTZ,
  consultation_fin     TIMESTAMPTZ,
  -- Synthèse médicale
  conclusion           TEXT,
  pronostic            VARCHAR(30),
  recommandations      TEXT,
  cloture_par          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cloture_le           TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_consult_statut CHECK (statut IN (
    'ACCUEIL','EN_ATTENTE_PAIEMENT','EN_CONSULTATION','EXAMEN_PARACLINIQUE',
    'RESULTATS','ORDONNANCE','CLOTURE','ANNULEE')),
  CONSTRAINT ck_clinique_consult_type CHECK (type_consultation IN (
    'CONSULTATION','URGENCE','CONTROLE','VACCINATION','CHIRURGIE','SUIVI')),
  CONSTRAINT ck_clinique_consult_pronostic CHECK (
    pronostic IS NULL OR pronostic IN ('FAVORABLE','RESERVE','DEFAVORABLE'))
);

COMMENT ON TABLE clinique_consultations IS 'Consultations de la clinique (accueil, frais figés, workflow de prise en charge).';

CREATE INDEX idx_clinique_consultations_animal ON clinique_consultations(animal_id);
CREATE INDEX idx_clinique_consultations_statut ON clinique_consultations(statut);
CREATE INDEX idx_clinique_consultations_accueil ON clinique_consultations(accueil_le DESC);

-- -----------------------------------------------------------------------------
-- Table : clinique_examens
-- Examen clinique d'une consultation. Deux natures :
--   * DISTANCE  : vue globale de l'aspect de l'animal (état général, attitude,
--                 comportement, embonpoint, signes extérieurs) ;
--   * RAPPROCHE : prise des constantes (température, fréquences, muqueuses,
--                 temps de recoloration capillaire, pli cutané, hydratation...).
-- Un seul examen de chaque nature par consultation.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_examens (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id                 UUID NOT NULL REFERENCES clinique_consultations(id) ON DELETE CASCADE,
  type_examen                     VARCHAR(20) NOT NULL,     -- DISTANCE, RAPPROCHE
  -- Examen à distance (vue globale)
  etat_general                    VARCHAR(30),              -- BON, MOYEN, MAUVAIS, CRITIQUE
  comportement                    VARCHAR(40),              -- CALME, AGITE, PROSTRE, AGRESSIF
  attitude                        VARCHAR(40),              -- DEBOUT, COUCHE, ASSIS
  embonpoint                      SMALLINT,                 -- 1 (maigre) .. 5 (obèse)
  signes_exterieurs               TEXT,                     -- lésions, plaies, boiterie visibles
  -- Examen rapproché (constantes)
  temperature_c                   NUMERIC(4,1),
  frequence_cardiaque             SMALLINT,
  frequence_respiratoire          SMALLINT,
  pulsation                       VARCHAR(60),
  temps_recoloration_capillaire_s NUMERIC(4,1),
  muqueuses                       VARCHAR(40),              -- NORMALES, PALES, ICTERIQUES, CYANOSEES
  pli_cutane                      VARCHAR(20),              -- NORMAL, DIMINUE, AUGMENTE
  hydratation                     VARCHAR(20),              -- NORMALE, DIMINUEE, DESHYDRATATION
  etat_nutrition                  VARCHAR(20),              -- NORMAL, MAIGRE, CACHEXIQUE, OBESE
  score_douleur                   SMALLINT,                 -- 0 .. 5
  lymphonoeuds                    VARCHAR(80),
  notes                           TEXT,
  examine_par                     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  examine_le                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clinique_examen_type UNIQUE (consultation_id, type_examen),
  CONSTRAINT ck_clinique_examen_type CHECK (type_examen IN ('DISTANCE','RAPPROCHE')),
  CONSTRAINT ck_clinique_examen_embonpoint CHECK (embonpoint IS NULL OR embonpoint BETWEEN 1 AND 5),
  CONSTRAINT ck_clinique_examen_douleur CHECK (score_douleur IS NULL OR score_douleur BETWEEN 0 AND 5)
);

COMMENT ON TABLE clinique_examens IS 'Examens cliniques (vue globale à distance et constantes rapprochées).';

CREATE INDEX idx_clinique_examens_consultation ON clinique_examens(consultation_id);

-- -----------------------------------------------------------------------------
-- Table : clinique_examens_organes
-- Examen organe par organe (ou appareil par appareil) d'un examen rapproché.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_examens_organes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  examen_id   UUID NOT NULL REFERENCES clinique_examens(id) ON DELETE CASCADE,
  organe      VARCHAR(80) NOT NULL,                        -- appareil / organe examiné
  etat        VARCHAR(20) NOT NULL DEFAULT 'NON_EXAMINE',  -- NORMAL, ANORMAL, NON_EXAMINE
  observation TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clinique_examen_organe UNIQUE (examen_id, organe),
  CONSTRAINT ck_clinique_organe_etat CHECK (etat IN ('NORMAL','ANORMAL','NON_EXAMINE'))
);

COMMENT ON TABLE clinique_examens_organes IS 'Examen organe par organe rattaché à un examen clinique.';

-- -----------------------------------------------------------------------------
-- Table : clinique_diagnostics
-- Diagnostics posés pour une consultation (confirmés, présomptifs, différentiels).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_diagnostics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES clinique_consultations(id) ON DELETE CASCADE,
  libelle         VARCHAR(200) NOT NULL,
  codification    VARCHAR(40),
  certitude       VARCHAR(20)  NOT NULL DEFAULT 'PRESOMPTIF',
  gravite         VARCHAR(20),
  commentaire     TEXT,
  pose_par        UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_diag_certitude CHECK (certitude IN ('CONFIRME','PRESOMPTIF','DIFFERENTIEL','INFIRME')),
  CONSTRAINT ck_clinique_diag_gravite CHECK (gravite IS NULL OR gravite IN ('FAIBLE','MODEREE','SEVERE','CRITIQUE'))
);

COMMENT ON TABLE clinique_diagnostics IS 'Diagnostics posés lors d''une consultation.';

CREATE INDEX idx_clinique_diagnostics_consultation ON clinique_diagnostics(consultation_id);

-- -----------------------------------------------------------------------------
-- Table : clinique_examens_paracliniques
-- Examens complémentaires demandés quand le diagnostic clinique ne suffit pas :
-- imagerie, radiographie, échographie, prélèvement et analyse de laboratoire.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_examens_paracliniques (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          VARCHAR(30)  NOT NULL UNIQUE,            -- PAR-2026-000123
  consultation_id UUID         NOT NULL REFERENCES clinique_consultations(id) ON DELETE CASCADE,
  type_examen     VARCHAR(30)  NOT NULL,
  libelle         VARCHAR(200) NOT NULL,
  indication      TEXT,
  statut          VARCHAR(20)  NOT NULL DEFAULT 'DEMANDE',
  montant         NUMERIC(12,2) NOT NULL DEFAULT 0,
  paye            BOOLEAN      NOT NULL DEFAULT FALSE,
  resultat        TEXT,
  conclusion      TEXT,
  demande_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  realise_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par      UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  demande_le      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  resultat_le     TIMESTAMPTZ,
  valide_le       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_para_type CHECK (type_examen IN (
    'IMAGERIE','RADIOGRAPHIE','ECHOGRAPHIE','PRELEVEMENT','ANALYSE_LABO','AUTRE')),
  CONSTRAINT ck_clinique_para_statut CHECK (statut IN ('DEMANDE','EN_COURS','RESULTAT','VALIDE','ANNULE'))
);

COMMENT ON TABLE clinique_examens_paracliniques IS 'Examens paracliniques (imagerie, radiographie, échographie, laboratoire).';

CREATE INDEX idx_clinique_para_consultation ON clinique_examens_paracliniques(consultation_id);
CREATE INDEX idx_clinique_para_statut ON clinique_examens_paracliniques(statut);

-- -----------------------------------------------------------------------------
-- Table : clinique_ordonnances
-- Prescription émise à l'issue d'une consultation et transmise à la pharmacie.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_ordonnances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          VARCHAR(30)  NOT NULL UNIQUE,            -- ORD-2026-000123
  consultation_id UUID         NOT NULL REFERENCES clinique_consultations(id) ON DELETE CASCADE,
  animal_id       UUID         NOT NULL REFERENCES clinique_animaux(id) ON DELETE RESTRICT,
  proprietaire_id UUID         NOT NULL REFERENCES clinique_proprietaires(id) ON DELETE RESTRICT,
  point_id        UUID REFERENCES pharmacie_points(id) ON DELETE SET NULL,
  instructions    TEXT,
  statut          VARCHAR(20)  NOT NULL DEFAULT 'EMISE',
  emis_par        UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  delivre_le      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_ordonnance_statut CHECK (statut IN ('BROUILLON','EMISE','SERVIE','ANNULEE'))
);

COMMENT ON TABLE clinique_ordonnances IS 'Ordonnances de la clinique transmises à la pharmacie.';

CREATE INDEX idx_clinique_ordonnances_consultation ON clinique_ordonnances(consultation_id);
CREATE INDEX idx_clinique_ordonnances_statut ON clinique_ordonnances(statut);

-- -----------------------------------------------------------------------------
-- Table : clinique_ordonnances_lignes
-- Produits prescrits. La désignation et le prix unitaire sont figés (snapshot) :
-- une évolution du référentiel produits ne modifie pas une ordonnance passée.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_ordonnances_lignes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordonnance_id  UUID NOT NULL REFERENCES clinique_ordonnances(id) ON DELETE CASCADE,
  produit_id     UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE RESTRICT,
  designation    VARCHAR(200) NOT NULL,
  dosage         VARCHAR(120),
  posologie      VARCHAR(200),
  voie           VARCHAR(60),
  duree_jours    SMALLINT,
  quantite       NUMERIC(10,2) NOT NULL DEFAULT 1,
  prix_unitaire  NUMERIC(12,2) NOT NULL DEFAULT 0,
  vendu          BOOLEAN      NOT NULL DEFAULT FALSE,
  vente_ligne_id UUID,
  notes          TEXT,
  ordre          SMALLINT     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_ordonnance_qte CHECK (quantite > 0)
);

COMMENT ON TABLE clinique_ordonnances_lignes IS 'Lignes de produits prescrits sur une ordonnance.';

CREATE INDEX idx_clinique_ordonnances_lignes_ordre ON clinique_ordonnances_lignes(ordonnance_id);

-- -----------------------------------------------------------------------------
-- Table : clinique_factures
-- Facture globale d'un passage : le caissier choisit les rubriques à inclure
-- (frais de consultation, examens paracliniques, montant de l'ordonnance, autres).
-- Les montants des rubriques sont figés au moment de l'émission.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_factures (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               VARCHAR(30)  NOT NULL UNIQUE,       -- FACT-2026-000123
  consultation_id      UUID REFERENCES clinique_consultations(id) ON DELETE SET NULL,
  animal_id            UUID REFERENCES clinique_animaux(id) ON DELETE SET NULL,
  proprietaire_id      UUID REFERENCES clinique_proprietaires(id) ON DELETE SET NULL,
  -- Choix des rubriques imprimées sur la facture
  inclure_consultation BOOLEAN      NOT NULL DEFAULT TRUE,
  inclure_examens      BOOLEAN      NOT NULL DEFAULT TRUE,
  inclure_ordonnance   BOOLEAN      NOT NULL DEFAULT TRUE,
  inclure_autres       BOOLEAN      NOT NULL DEFAULT TRUE,
  montant_consultation NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant_examens      NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant_ordonnance   NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant_autres       NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  statut               VARCHAR(20)  NOT NULL DEFAULT 'EMISE',
  mode_paiement        VARCHAR(20),
  total_paye           NUMERIC(12,2) NOT NULL DEFAULT 0,
  reste_a_payer        NUMERIC(12,2) NOT NULL DEFAULT 0,
  commentaire          TEXT,
  generee_par          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_facture         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_facture_statut CHECK (statut IN ('EMISE','PARTIELLE','PAYEE','ANNULEE'))
);

COMMENT ON TABLE clinique_factures IS 'Factures globales de la clinique (rubriques incluses paramétrables).';

CREATE INDEX idx_clinique_factures_consultation ON clinique_factures(consultation_id);
CREATE INDEX idx_clinique_factures_date ON clinique_factures(date_facture DESC);

-- -----------------------------------------------------------------------------
-- Table : clinique_factures_lignes
-- Détail imprimé de la facture, une ligne par prestation facturée.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinique_factures_lignes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id     UUID NOT NULL REFERENCES clinique_factures(id) ON DELETE CASCADE,
  rubrique       VARCHAR(20)  NOT NULL,                    -- CONSULTATION, EXAMEN, PRODUIT, AUTRE
  designation    VARCHAR(200) NOT NULL,
  quantite       NUMERIC(10,2) NOT NULL DEFAULT 1,
  prix_unitaire  NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant        NUMERIC(12,2) NOT NULL DEFAULT 0,
  reference_type VARCHAR(40),
  reference_id   UUID,
  ordre          SMALLINT     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_clinique_facture_ligne_rubrique CHECK (rubrique IN ('CONSULTATION','EXAMEN','PRODUIT','AUTRE'))
);

COMMENT ON TABLE clinique_factures_lignes IS 'Lignes de détail des factures de la clinique.';

CREATE INDEX idx_clinique_factures_lignes_facture ON clinique_factures_lignes(facture_id);

-- -----------------------------------------------------------------------------
-- Rattachement des ventes de la pharmacie au parcours clinique :
-- une vente saisie sur ordonnance porte l'ordonnance et la consultation
-- d'origine. Les colonnes sont nullables : une vente comptoir n'en a pas.
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_ventes ADD COLUMN IF NOT EXISTS ordonnance_id  UUID;
ALTER TABLE pharmacie_ventes ADD COLUMN IF NOT EXISTS consultation_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pharmacie_ventes_ordonnance') THEN
    ALTER TABLE pharmacie_ventes
      ADD CONSTRAINT fk_pharmacie_ventes_ordonnance
      FOREIGN KEY (ordonnance_id) REFERENCES clinique_ordonnances(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pharmacie_ventes_consultation') THEN
    ALTER TABLE pharmacie_ventes
      ADD CONSTRAINT fk_pharmacie_ventes_consultation
      FOREIGN KEY (consultation_id) REFERENCES clinique_consultations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_ordonnance ON pharmacie_ventes(ordonnance_id);

-- -----------------------------------------------------------------------------
-- Horodatage automatique (updated_at) de toutes les tables du module.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'clinique_referentiels', 'clinique_proprietaires', 'clinique_animaux',
    'clinique_consultations', 'clinique_examens', 'clinique_examens_organes',
    'clinique_diagnostics', 'clinique_examens_paracliniques',
    'clinique_ordonnances', 'clinique_ordonnances_lignes',
    'clinique_factures', 'clinique_factures_lignes'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(v_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_maj_horodatage ON %I', v_table);
      EXECUTE format(
        'CREATE TRIGGER trg_maj_horodatage BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage()', v_table);
    END IF;
  END LOOP;
END $$;



