-- Module Pharmacie : structure de la base de donnees.
-- SGBD : PostgreSQL >= 14 | Base : gae_gestiondb
-- A executer APRES 05_seed_utilisateurs.sql (depend des tables IAM).
--
-- Organisation logique :
--   pharmacie_points            -> points de vente (siege + succursales)
--   pharmacie_produits          -> referentiel central des produits (fiche maitre)
--   pharmacie_produits_points   -> parametrage local (prix, seuil, disponibilite)
--   pharmacie_lots              -> lots et dates de peremption par point
--   pharmacie_mouvements_stock  -> entrees / sorties / ajustements de stock
--   pharmacie_fournisseurs      -> fournisseurs
--   pharmacie_commandes         -> commandes d'approvisionnement (+ lignes)
--   pharmacie_receptions        -> receptions de commandes (facture fournisseur)
--   pharmacie_inventaires       -> sessions d'inventaire (+ lignes)
--   pharmacie_ventes            -> ventes comptoir (+ lignes)
--   pharmacie_paiements         -> encaissements d'une vente
--   pharmacie_caisses           -> sessions de caisse par point

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Table : pharmacie_points (points de vente)
-- La pharmacie du siege et celles des succursales. Chaque point est rattache a
-- une structure de l'organigramme (departements) et possede son propre stock.
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_points (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(40)  NOT NULL UNIQUE,
  nom            VARCHAR(150) NOT NULL,
  departement_id UUID REFERENCES departements(id) ON DELETE SET NULL,
  type_point     VARCHAR(20)  NOT NULL DEFAULT 'SUCCURSALE',
  ville          VARCHAR(120),
  adresse        VARCHAR(200),
  telephone      VARCHAR(30),
  email          VARCHAR(180),
  responsable_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  devise         VARCHAR(8)   NOT NULL DEFAULT 'XOF',
  actif          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_points_type CHECK (type_point IN ('SIEGE','SUCCURSALE'))
);

COMMENT ON TABLE  pharmacie_points IS 'Points de vente de la pharmacie (siege et succursales).';
COMMENT ON COLUMN pharmacie_points.departement_id IS 'Rattachement a une structure de l''organigramme.';

CREATE INDEX idx_pharmacie_points_departement ON pharmacie_points(departement_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_produits (referentiel central)
-- Fiche maitre unique partagee par tous les points. Les prix, seuils et
-- disponibilites sont portes par pharmacie_produits_points.
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_produits (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 VARCHAR(40)  NOT NULL UNIQUE,
  code_barres          VARCHAR(60),
  dci                  VARCHAR(150),
  nom_commercial       VARCHAR(180) NOT NULL,
  forme_galenique      VARCHAR(60),
  dosage               VARCHAR(80),
  presentation         VARCHAR(120),
  categorie            VARCHAR(60)  NOT NULL DEFAULT 'MEDICAMENT_VETO',
  unite_mesure         VARCHAR(20)  NOT NULL DEFAULT 'UNITE',
  necessite_ordonnance BOOLEAN      NOT NULL DEFAULT FALSE,
  tva_taux             NUMERIC(5,2) NOT NULL DEFAULT 0,
  laboratoire          VARCHAR(150),
  description          TEXT,
  actif                BOOLEAN      NOT NULL DEFAULT TRUE,
  cree_par             UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  pharmacie_produits IS 'Referentiel central des produits veterinaires (fiche maitre).';
COMMENT ON COLUMN pharmacie_produits.dci IS 'Denomination commune internationale (molecule active).';

CREATE INDEX idx_pharmacie_produits_categorie ON pharmacie_produits(categorie);
CREATE UNIQUE INDEX uq_pharmacie_produits_code_barres
  ON pharmacie_produits(code_barres) WHERE code_barres IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Table : pharmacie_produits_points (parametrage par point)
-- Une ligne par couple (produit, point) : chaque pharmacie gere ses prix,
-- seuils d'alerte et sa disponibilite pour le produit du referentiel.
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_produits_points (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id            UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE CASCADE,
  point_id              UUID NOT NULL REFERENCES pharmacie_points(id)   ON DELETE CASCADE,
  prix_vente            NUMERIC(12,2) NOT NULL DEFAULT 0,
  prix_achat_reference  NUMERIC(12,2) NOT NULL DEFAULT 0,
  seuil_alerte          INTEGER NOT NULL DEFAULT 0,
  quantite_max          INTEGER,
  reference_locale      VARCHAR(60),
  disponible            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pharmacie_produits_points UNIQUE (produit_id, point_id)
);

COMMENT ON TABLE pharmacie_produits_points IS 'Parametrage local d''un produit dans un point (prix, seuil, dispo).';

CREATE INDEX idx_pharmacie_produits_points_point ON pharmacie_produits_points(point_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_lots (lots et peremptions)
-- Un lot correspond a une entree de marchandise (numero de lot + peremption).
-- Le stock reel d'un produit dans un point est la somme de ses lots.
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_lots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id            UUID NOT NULL REFERENCES pharmacie_points(id)   ON DELETE CASCADE,
  produit_id          UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE CASCADE,
  numero_lot          VARCHAR(80),
  date_peremption     DATE,
  prix_achat_unitaire NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantite_entree     INTEGER NOT NULL DEFAULT 0,
  cree_le             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pharmacie_lots IS 'Lots de produits par point (numero, peremption, prix d''achat).';

CREATE INDEX idx_pharmacie_lots_point_produit ON pharmacie_lots(point_id, produit_id);
CREATE INDEX idx_pharmacie_lots_peremption ON pharmacie_lots(date_peremption);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_mouvements_stock (entrees / sorties)
-- Chaque mouvement est trace : type, quantite, cout unitaire, auteur et
-- reference d'origine (vente, commande, inventaire, transfert...).
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_mouvements_stock (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id         UUID NOT NULL REFERENCES pharmacie_points(id)   ON DELETE CASCADE,
  produit_id       UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE RESTRICT,
  lot_id           UUID REFERENCES pharmacie_lots(id) ON DELETE SET NULL,
  type_mouvement   VARCHAR(20) NOT NULL,
  quantite         INTEGER NOT NULL,
  prix_unitaire    NUMERIC(12,2) NOT NULL DEFAULT 0,
  motif            VARCHAR(200),
  reference_type   VARCHAR(30),
  reference_id     UUID,
  utilisateur_id   UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_mouvement_type CHECK (
    type_mouvement IN ('ENTREE','SORTIE','AJUSTEMENT','TRANSFERT_ENTREE','TRANSFERT_SORTIE','RETOUR')
  )
);

COMMENT ON TABLE pharmacie_mouvements_stock IS 'Mouvements de stock : entrees, sorties, ajustements et transferts.';

CREATE INDEX idx_pharmacie_mvt_point_produit ON pharmacie_mouvements_stock(point_id, produit_id);
CREATE INDEX idx_pharmacie_mvt_date ON pharmacie_mouvements_stock(cree_le DESC);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_fournisseurs
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_fournisseurs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR(40)  NOT NULL UNIQUE,
  nom                VARCHAR(180) NOT NULL,
  contact            VARCHAR(150),
  telephone          VARCHAR(30),
  email              VARCHAR(180),
  adresse            VARCHAR(200),
  ville              VARCHAR(120),
  pays               VARCHAR(120) NOT NULL DEFAULT 'Togo',
  nif                VARCHAR(60),
  conditions_paiement VARCHAR(150),
  delai_livraison_jours INTEGER,
  actif              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pharmacie_fournisseurs IS 'Fournisseurs de produits de la pharmacie.';

-- -----------------------------------------------------------------------------
-- Table : pharmacie_commandes (approvisionnement)
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_commandes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              VARCHAR(40) NOT NULL UNIQUE,
  point_id            UUID NOT NULL REFERENCES pharmacie_points(id)      ON DELETE RESTRICT,
  fournisseur_id      UUID NOT NULL REFERENCES pharmacie_fournisseurs(id) ON DELETE RESTRICT,
  statut              VARCHAR(20) NOT NULL DEFAULT 'BROUILLON',
  date_commande       DATE NOT NULL DEFAULT CURRENT_DATE,
  date_livraison_prevue DATE,
  total_ht            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tva           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ttc           NUMERIC(14,2) NOT NULL DEFAULT 0,
  commentaire         TEXT,
  cree_par            UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_commande_statut CHECK (
    statut IN ('BROUILLON','ENVOYEE','PARTIELLE','RECUE','ANNULEE')
  )
);

COMMENT ON TABLE pharmacie_commandes IS 'Commandes d''approvisionnement passees aupres des fournisseurs.';

CREATE INDEX idx_pharmacie_commandes_point ON pharmacie_commandes(point_id);
CREATE INDEX idx_pharmacie_commandes_fournisseur ON pharmacie_commandes(fournisseur_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_commandes_lignes
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_commandes_lignes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id        UUID NOT NULL REFERENCES pharmacie_commandes(id) ON DELETE CASCADE,
  produit_id         UUID NOT NULL REFERENCES pharmacie_produits(id)  ON DELETE RESTRICT,
  quantite_commandee INTEGER NOT NULL DEFAULT 0,
  quantite_recue     INTEGER NOT NULL DEFAULT 0,
  prix_unitaire      NUMERIC(12,2) NOT NULL DEFAULT 0,
  remise             NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ligne        NUMERIC(14,2) NOT NULL DEFAULT 0
);

COMMENT ON TABLE pharmacie_commandes_lignes IS 'Lignes d''une commande d''approvisionnement.';

CREATE INDEX idx_pharmacie_commandes_lignes_commande ON pharmacie_commandes_lignes(commande_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_receptions (reception d'une commande)
-- La validation d'une reception genere les entrees de stock correspondantes.
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_receptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id           UUID NOT NULL REFERENCES pharmacie_commandes(id) ON DELETE CASCADE,
  point_id              UUID NOT NULL REFERENCES pharmacie_points(id)   ON DELETE RESTRICT,
  date_reception        DATE NOT NULL DEFAULT CURRENT_DATE,
  numero_facture        VARCHAR(80),
  montant_facture       NUMERIC(14,2) NOT NULL DEFAULT 0,
  commentaire           TEXT,
  recepteur_id          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pharmacie_receptions IS 'Receptions de commandes (factures fournisseurs).';

CREATE INDEX idx_pharmacie_receptions_commande ON pharmacie_receptions(commande_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_inventaires (sessions d'inventaire par point)
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_inventaires (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       VARCHAR(40) NOT NULL UNIQUE,
  point_id     UUID NOT NULL REFERENCES pharmacie_points(id) ON DELETE CASCADE,
  libelle      VARCHAR(150),
  statut       VARCHAR(20) NOT NULL DEFAULT 'OUVERT',
  date_debut   TIMESTAMPTZ NOT NULL DEFAULT now(),
  date_fin     TIMESTAMPTZ,
  commentaire  TEXT,
  cree_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par   UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  CONSTRAINT ck_pharmacie_inventaire_statut CHECK (statut IN ('OUVERT','CLOTURE','VALIDE','ANNULE'))
);

COMMENT ON TABLE pharmacie_inventaires IS 'Sessions d''inventaire du stock par point de vente.';

CREATE INDEX idx_pharmacie_inventaires_point ON pharmacie_inventaires(point_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_inventaires_lignes (comptage theorique vs physique)
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_inventaires_lignes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventaire_id      UUID NOT NULL REFERENCES pharmacie_inventaires(id) ON DELETE CASCADE,
  produit_id         UUID NOT NULL REFERENCES pharmacie_produits(id)    ON DELETE RESTRICT,
  lot_id             UUID REFERENCES pharmacie_lots(id) ON DELETE SET NULL,
  quantite_theorique INTEGER NOT NULL DEFAULT 0,
  quantite_physique  INTEGER,
  ecart              INTEGER,
  prix_unitaire      NUMERIC(12,2) NOT NULL DEFAULT 0
);

COMMENT ON TABLE pharmacie_inventaires_lignes IS 'Lignes de comptage d''un inventaire.';

CREATE INDEX idx_pharmacie_inventaires_lignes_inventaire ON pharmacie_inventaires_lignes(inventaire_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_ventes (ventes comptoir)
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_ventes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       VARCHAR(40) NOT NULL UNIQUE,
  point_id     UUID NOT NULL REFERENCES pharmacie_points(id) ON DELETE RESTRICT,
  client_nom   VARCHAR(150),
  client_contact VARCHAR(60),
  type_vente   VARCHAR(20) NOT NULL DEFAULT 'COMPTOIR',
  total_ht     NUMERIC(14,2) NOT NULL DEFAULT 0,
  remise       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tva    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ttc    NUMERIC(14,2) NOT NULL DEFAULT 0,
  cout_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
  marge        NUMERIC(14,2) NOT NULL DEFAULT 0,
  statut       VARCHAR(20) NOT NULL DEFAULT 'VALIDEE',
  vendeur_id   UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_vente   TIMESTAMPTZ NOT NULL DEFAULT now(),
  annule_le    TIMESTAMPTZ,
  motif_annulation TEXT,
  CONSTRAINT ck_pharmacie_vente_statut CHECK (statut IN ('VALIDEE','ANNULEE')),
  CONSTRAINT ck_pharmacie_vente_type CHECK (type_vente IN ('COMPTOIR','ORDONNANCE','COMMANDE'))
);

COMMENT ON TABLE pharmacie_ventes IS 'Ventes de la pharmacie (comptoir, ordonnance, commande).';

CREATE INDEX idx_pharmacie_ventes_point ON pharmacie_ventes(point_id);
CREATE INDEX idx_pharmacie_ventes_date ON pharmacie_ventes(date_vente DESC);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_ventes_lignes
-- cout_unitaire est conserve pour le calcul de la marge au moment de la vente.
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_ventes_lignes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id      UUID NOT NULL REFERENCES pharmacie_ventes(id)   ON DELETE CASCADE,
  produit_id    UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE RESTRICT,
  lot_id        UUID REFERENCES pharmacie_lots(id) ON DELETE SET NULL,
  quantite      INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(12,2) NOT NULL DEFAULT 0,
  cout_unitaire NUMERIC(12,2) NOT NULL DEFAULT 0,
  remise        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ligne   NUMERIC(14,2) NOT NULL DEFAULT 0
);

COMMENT ON TABLE pharmacie_ventes_lignes IS 'Lignes de vente (produit, quantite, prix, cout).';

CREATE INDEX idx_pharmacie_ventes_lignes_vente ON pharmacie_ventes_lignes(vente_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_paiements (encaissements)
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_paiements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id      UUID NOT NULL REFERENCES pharmacie_ventes(id) ON DELETE CASCADE,
  mode          VARCHAR(20) NOT NULL DEFAULT 'ESPECES',
  montant       NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference     VARCHAR(80),
  encaisse_par  UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_paiement TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_paiement_mode CHECK (
    mode IN ('ESPECES','MOBILE_MONEY','CARTE','CHEQUE','CREDIT','VIREMENT')
  )
);

COMMENT ON TABLE pharmacie_paiements IS 'Encaissements d''une vente (plusieurs modes possibles).';

CREATE INDEX idx_pharmacie_paiements_vente ON pharmacie_paiements(vente_id);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_caisses (sessions de caisse par point)
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacie_caisses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id           UUID NOT NULL REFERENCES pharmacie_points(id) ON DELETE CASCADE,
  ouverte_par        UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cloturee_par       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  montant_ouverture  NUMERIC(14,2) NOT NULL DEFAULT 0,
  montant_attendu    NUMERIC(14,2),
  montant_compte     NUMERIC(14,2),
  ecart              NUMERIC(14,2),
  statut             VARCHAR(20) NOT NULL DEFAULT 'OUVERTE',
  ouverte_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cloturee_le        TIMESTAMPTZ,
  CONSTRAINT ck_pharmacie_caisse_statut CHECK (statut IN ('OUVERTE','CLOTUREE'))
);

COMMENT ON TABLE pharmacie_caisses IS 'Sessions de caisse (ouverture / cloture) par point de vente.';

CREATE INDEX idx_pharmacie_caisses_point ON pharmacie_caisses(point_id);

-- -----------------------------------------------------------------------------
-- Triggers : mise a jour automatique de updated_at
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_pharmacie_points_maj BEFORE UPDATE ON pharmacie_points
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
CREATE TRIGGER trg_pharmacie_produits_maj BEFORE UPDATE ON pharmacie_produits
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
CREATE TRIGGER trg_pharmacie_produits_points_maj BEFORE UPDATE ON pharmacie_produits_points
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
CREATE TRIGGER trg_pharmacie_fournisseurs_maj BEFORE UPDATE ON pharmacie_fournisseurs
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
CREATE TRIGGER trg_pharmacie_commandes_maj BEFORE UPDATE ON pharmacie_commandes
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
