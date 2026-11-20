-- =============================================================================
-- GAE - ERP : 02_vues_fonctions.sql
-- Vues et fonctions utilitaires du module IAM.
-- À exécuter APRÈS 01_schema.sql.
--   fn_est_super_admin        : l'utilisateur a-t-il le rôle super administrateur ?
--   fn_permissions_utilisateur: liste des codes de permissions effectifs
--   fn_arbre_departements     : organigramme aplati avec chemin et effectif
--   v_utilisateurs_effectifs  : fiche utilisateur enrichie (département + rôles)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Un utilisateur est-il super administrateur ? (accès total, contourne le RBAC)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_est_super_admin(p_utilisateur_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE((
    SELECT u.super_admin
    FROM utilisateurs u
    WHERE u.id = p_utilisateur_id
      AND u.statut = 'ACTIF'
      AND u.super_admin = TRUE
  ), FALSE);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_est_super_admin(UUID) IS 'Vrai si le compte est actif et marqué super administrateur.';

-- -----------------------------------------------------------------------------
-- Permissions effectives d'un utilisateur : union des permissions de ses rôles
-- actifs. Un super administrateur possède par définition toutes les permissions.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_permissions_utilisateur(p_utilisateur_id UUID)
RETURNS TABLE (code_permission VARCHAR) AS $$
  SELECT DISTINCT p.code
  FROM utilisateurs u
  JOIN utilisateurs_roles ur ON ur.utilisateur_id = u.id
  JOIN roles r              ON r.id = ur.role_id
  JOIN roles_permissions rp ON rp.role_id = r.id
  JOIN permissions p        ON p.id = rp.permission_id
  WHERE u.id = p_utilisateur_id
    AND u.statut = 'ACTIF'
    AND r.actif = TRUE

  UNION

  -- Super administrateur : toutes les permissions du catalogue
  SELECT p.code
  FROM permissions p
  WHERE fn_est_super_admin(p_utilisateur_id);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_permissions_utilisateur(UUID) IS 'Codes de permissions effectives (rôles actifs + super admin).';

-- -----------------------------------------------------------------------------
-- Organigramme aplati : chemin matérialisé, niveau et effectif par département
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_arbre_departements()
RETURNS TABLE (
  id          UUID,
  code        VARCHAR,
  nom         VARCHAR,
  parent_id   UUID,
  chemin      VARCHAR,
  niveau      SMALLINT,
  type_unite  VARCHAR,
  ville       VARCHAR,
  actif       BOOLEAN,
  effectif    BIGINT
) AS $$
  WITH RECURSIVE arbre AS (
    -- Racines de l'organigramme
    SELECT d.id, d.code, d.nom, d.parent_id, d.type_unite, d.ville, d.actif,
           ('/' || d.code)::VARCHAR(500) AS chemin_calcule,
           0::SMALLINT                   AS niveau_calcule
    FROM departements d
    WHERE d.parent_id IS NULL
    UNION ALL
    -- Descendants
    SELECT d.id, d.code, d.nom, d.parent_id, d.type_unite, d.ville, d.actif,
           (a.chemin_calcule || '/' || d.code)::VARCHAR(500),
           (a.niveau_calcule + 1)::SMALLINT
    FROM departements d
    JOIN arbre a ON d.parent_id = a.id
  )
  SELECT a.id, a.code, a.nom, a.parent_id, a.chemin_calcule, a.niveau_calcule,
         a.type_unite, a.ville, a.actif,
         (SELECT count(*) FROM utilisateurs u WHERE u.departement_id = a.id) AS effectif
  FROM arbre a
  ORDER BY a.chemin_calcule;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_arbre_departements() IS 'Renvoie l''organigramme aplati (chemin, niveau, effectif).';

-- -----------------------------------------------------------------------------
-- Vue : fiche utilisateur enrichie (département + rôles concaténés + permissions)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_utilisateurs_effectifs AS
SELECT
  u.id,
  u.matricule,
  u.nom,
  u.prenom,
  u.nom || ' ' || u.prenom                AS nom_complet,
  u.email,
  u.telephone,
  u.fonction,
  u.statut,
  u.super_admin,
  u.doit_changer_mdp,
  u.derniere_connexion,
  u.verrouille_jusqua,
  u.created_at,
  d.id                                    AS departement_id,
  d.code                                  AS departement_code,
  d.nom                                   AS departement_nom,
  d.type_unite                            AS departement_type,
  COALESCE(r.roles_codes, '')             AS roles_codes,
  COALESCE(r.nb_roles, 0)                 AS nb_roles,
  (SELECT count(*) FROM fn_permissions_utilisateur(u.id)) AS nb_permissions
FROM utilisateurs u
LEFT JOIN departements d ON d.id = u.departement_id
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT ro.code, ',' ORDER BY ro.code) AS roles_codes,
         count(DISTINCT ro.id)                              AS nb_roles
  FROM utilisateurs_roles ur
  JOIN roles ro ON ro.id = ur.role_id
  WHERE ur.utilisateur_id = u.id AND ro.actif = TRUE
) r ON TRUE;

COMMENT ON VIEW v_utilisateurs_effectifs IS 'Vue de reporting : utilisateurs avec département, rôles et nombre de permissions.';
