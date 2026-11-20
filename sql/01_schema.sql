-- =============================================================================
-- GAE - ERP : 01_schema.sql
-- Module IAM (Identity & Access Management) : structure de la base de données.
-- SGBD : PostgreSQL >= 14   |   Base : gae_gestiondb
-- Aucune extension requise (gen_random_uuid() est natif depuis PostgreSQL 13).
-- Exécution : psql -U Geek -d gae_gestiondb -f sql/01_schema.sql
--
-- Organisation logique :
--   departements      -> organigramme du Groupe Agro-Expertise (hiérarchie)
--   permissions       -> catalogue des droits unitaires  (module.ressource.action)
--   roles             -> regroupements de permissions
--   utilisateurs      -> comptes d'accès à la plateforme
--   utilisateurs_roles / roles_permissions -> tables de liaison (RBAC)
--   utilisateurs_departements -> affectations secondaires (succursales multi-sites)
--   jetons_*          -> sécurité des sessions (refresh token, mot de passe oublié)
--   journal_audit     -> traçabilité des actions sensibles
-- =============================================================================

-- Identifiants UUID : gen_random_uuid() appartient au coeur de PostgreSQL depuis
-- la version 13 (fonction pg_catalog). Aucune extension n'est donc nécessaire
-- avec PostgreSQL >= 14, prérequis de ce projet.
-- Note : l'extension pgcrypto n'était utilisée que pour cette génération.
-- Aucune fonction de chiffrement (crypt, gen_salt, pgp_sym_encrypt...) n'est
-- appelée en base : les mots de passe sont hachés en bcrypt côté Node
-- (src/utils/hachage.js) et les jetons en SHA-256 (src/utils/jetons.js).

-- -----------------------------------------------------------------------------
-- Fonction générique : met à jour automatiquement la colonne updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_maj_horodatage()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Table : departements  (organigramme GAE)
-- Chaque direction / service / succursale est un département. La hiérarchie est
-- matérialisée par parent_id + chemin (ex. '/DG/DT/PHARMA/PHARMA_SUCC').
-- -----------------------------------------------------------------------------
CREATE TABLE departements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(40)  NOT NULL UNIQUE,          -- ex. 'DT', 'PHARMA_SUCC'
  nom             VARCHAR(150) NOT NULL,                 -- libellé affiché
  description     TEXT,
  parent_id       UUID REFERENCES departements(id) ON DELETE SET NULL,
  chemin          VARCHAR(500) NOT NULL DEFAULT '/',     -- chemin matérialisé
  niveau          SMALLINT     NOT NULL DEFAULT 0,       -- profondeur dans l'arbre
  type_unite      VARCHAR(20)  NOT NULL DEFAULT 'SERVICE',
  ville           VARCHAR(120),                          -- localisation / succursale
  ordre           SMALLINT     NOT NULL DEFAULT 0,       -- ordre d'affichage
  actif           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_departements_type CHECK (
    type_unite IN ('DIRECTION','DEPARTEMENT','SERVICE','SUCCURSALE','UNITE')
  )
);

COMMENT ON TABLE  departements IS 'Organigramme du Groupe Agro-Expertise (directions, services, succursales, unités).';
COMMENT ON COLUMN departements.type_unite IS 'Nature de la structure : DIRECTION, DEPARTEMENT, SERVICE, SUCCURSALE ou UNITE.';
COMMENT ON COLUMN departements.chemin IS 'Chemin matérialisé du noeud dans l''arbre, ex. /DG/DT/PHARMA.';

CREATE INDEX idx_departements_parent ON departements(parent_id);
CREATE INDEX idx_departements_chemin ON departements(chemin);

-- -----------------------------------------------------------------------------
-- Table : permissions  (catalogue des droits unitaires)
-- Convention de nommage : <module>.<ressource>.<action>  ex. iam.users.create
-- -----------------------------------------------------------------------------
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(120) NOT NULL UNIQUE,
  module      VARCHAR(40)  NOT NULL,                     -- iam, clinique, pharmacie...
  ressource   VARCHAR(60)  NOT NULL,                     -- users, roles, stocks...
  action      VARCHAR(20)  NOT NULL,                     -- read, create, update...
  nom         VARCHAR(160) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_permissions_action CHECK (
    action IN ('read','create','update','delete','assign','validate','export','manage')
  )
);

COMMENT ON TABLE permissions IS 'Catalogue des droits unitaires utilisables dans le RBAC.';

CREATE INDEX idx_permissions_module ON permissions(module);

-- -----------------------------------------------------------------------------
-- Table : roles  (rôles métier du groupe)
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(60)  NOT NULL UNIQUE,          -- DG, TRESORIER, TECHNICIEN...
  nom             VARCHAR(120) NOT NULL,
  description     TEXT,
  departement_id  UUID REFERENCES departements(id) ON DELETE SET NULL,
  niveau          SMALLINT     NOT NULL DEFAULT 50,      -- 1 = plus haut niveau hiérarchique
  systeme         BOOLEAN      NOT NULL DEFAULT FALSE,   -- rôle protégé (non supprimable)
  actif           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  roles IS 'Rôles métier regroupant des permissions (RBAC).';
COMMENT ON COLUMN roles.systeme IS 'TRUE = rôle système (SUPER_ADMIN...) : non modifiable/supprimable par l''API.';
COMMENT ON COLUMN roles.niveau IS 'Niveau hiérarchique : 1 = Direction Générale, 100 = stagiaires.';

CREATE INDEX idx_roles_departement ON roles(departement_id);

-- -----------------------------------------------------------------------------
-- Table : utilisateurs
-- -----------------------------------------------------------------------------
CREATE TABLE utilisateurs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matricule             VARCHAR(30)  NOT NULL UNIQUE,
  nom                   VARCHAR(80)  NOT NULL,
  prenom                VARCHAR(80)  NOT NULL,
  email                 VARCHAR(180) NOT NULL,
  telephone             VARCHAR(30),
  mot_de_passe_hash     TEXT         NOT NULL,
  departement_id        UUID REFERENCES departements(id) ON DELETE SET NULL,
  fonction              VARCHAR(120),                    -- intitulé du poste
  statut                VARCHAR(20)  NOT NULL DEFAULT 'ACTIF',
  super_admin           BOOLEAN      NOT NULL DEFAULT FALSE,  -- accès total (bypass RBAC)
  doit_changer_mdp      BOOLEAN      NOT NULL DEFAULT TRUE,   -- mot de passe provisoire
  tentatives_connexion  SMALLINT     NOT NULL DEFAULT 0,
  verrouille_jusqua     TIMESTAMPTZ,                     -- anti force brute
  derniere_connexion    TIMESTAMPTZ,
  cree_par              UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_utilisateurs_statut CHECK (statut IN ('ACTIF','INACTIF','SUSPENDU','ARCHIVE'))
);

COMMENT ON TABLE  utilisateurs IS 'Comptes d''accès à la plateforme ERP du Groupe Agro-Expertise.';
COMMENT ON COLUMN utilisateurs.super_admin IS 'TRUE = contourne toutes les vérifications de permissions.';
COMMENT ON COLUMN utilisateurs.doit_changer_mdp IS 'Force le changement du mot de passe à la première connexion.';

CREATE UNIQUE INDEX uq_utilisateurs_email ON utilisateurs (lower(email));
CREATE INDEX idx_utilisateurs_departement ON utilisateurs(departement_id);
CREATE INDEX idx_utilisateurs_statut ON utilisateurs(statut);

-- -----------------------------------------------------------------------------
-- Liaison : utilisateurs <-> roles
-- -----------------------------------------------------------------------------
CREATE TABLE utilisateurs_roles (
  utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  role_id        UUID NOT NULL REFERENCES roles(id)        ON DELETE CASCADE,
  attribue_par   UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  attribue_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, role_id)
);

COMMENT ON TABLE utilisateurs_roles IS 'Affectation des rôles aux utilisateurs.';

-- -----------------------------------------------------------------------------
-- Liaison : roles <-> permissions
-- -----------------------------------------------------------------------------
CREATE TABLE roles_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

COMMENT ON TABLE roles_permissions IS 'Permissions accordées à chaque rôle.';

-- -----------------------------------------------------------------------------
-- Liaison : utilisateurs <-> departements secondaires
-- Permet à un agent de couvrir plusieurs services / succursales (ex. Pharmacie).
-- -----------------------------------------------------------------------------
CREATE TABLE utilisateurs_departements (
  utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  departement_id UUID NOT NULL REFERENCES departements(id) ON DELETE CASCADE,
  principal      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (utilisateur_id, departement_id)
);

COMMENT ON TABLE utilisateurs_departements IS 'Affectations multiples d''un utilisateur à des départements/succursales.';

-- -----------------------------------------------------------------------------
-- Table : jetons_rafraichissement  (sessions persistantes / refresh tokens)
-- Seul le SHA-256 du jeton est stocké : une fuite de base ne compromet pas les sessions.
-- -----------------------------------------------------------------------------
CREATE TABLE jetons_rafraichissement (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jeton_hash     VARCHAR(64) NOT NULL UNIQUE,            -- empreinte SHA-256
  user_agent     TEXT,
  adresse_ip     VARCHAR(60),
  expire_le      TIMESTAMPTZ NOT NULL,
  revoque_le     TIMESTAMPTZ,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE jetons_rafraichissement IS 'Sessions de rafraîchissement (rotation des jetons JWT).';

CREATE INDEX idx_jetons_rafraichissement_user ON jetons_rafraichissement(utilisateur_id);

-- -----------------------------------------------------------------------------
-- Table : jetons_reinitialisation  (mot de passe oublié)
-- -----------------------------------------------------------------------------
CREATE TABLE jetons_reinitialisation (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jeton_hash     VARCHAR(64) NOT NULL UNIQUE,
  expire_le      TIMESTAMPTZ NOT NULL,
  utilise_le     TIMESTAMPTZ,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE jetons_reinitialisation IS 'Jetons à usage unique pour la réinitialisation de mot de passe.';

-- -----------------------------------------------------------------------------
-- Table : journal_audit  (traçabilité des actions sensibles)
-- -----------------------------------------------------------------------------
CREATE TABLE journal_audit (
  id             BIGSERIAL PRIMARY KEY,
  utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  acteur_email   VARCHAR(180),                           -- conservé même si le compte est supprimé
  action         VARCHAR(60)  NOT NULL,                  -- CONNEXION, CREATION_UTILISATEUR...
  module         VARCHAR(40)  NOT NULL DEFAULT 'iam',
  entite         VARCHAR(60),                            -- utilisateur, role, departement...
  entite_id      VARCHAR(60),
  statut         VARCHAR(20)  NOT NULL DEFAULT 'SUCCES',
  adresse_ip     VARCHAR(60),
  user_agent     TEXT,
  details        JSONB,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_journal_statut CHECK (statut IN ('SUCCES','ECHEC'))
);

COMMENT ON TABLE journal_audit IS 'Journal d''audit : qui a fait quoi, quand, depuis où.';

CREATE INDEX idx_journal_audit_date ON journal_audit(cree_le DESC);
CREATE INDEX idx_journal_audit_user ON journal_audit(utilisateur_id);
CREATE INDEX idx_journal_audit_action ON journal_audit(action);

-- -----------------------------------------------------------------------------
-- Triggers : mise à jour automatique de updated_at
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_departements_maj BEFORE UPDATE ON departements
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
CREATE TRIGGER trg_roles_maj BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
CREATE TRIGGER trg_utilisateurs_maj BEFORE UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();
