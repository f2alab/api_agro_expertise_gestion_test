-- =============================================================================
-- GAE - ERP : 05_seed_utilisateurs.sql
-- Comptes de démarrage du module IAM.
--
--   | Compte                              | Mot de passe | Profil              |
--   |-------------------------------------|--------------|---------------------|
--   | admin@agro-expertise.com            | Admin@2026   | Super administrateur|
--   | demo.dg@agro-expertise.com          | Demo@2026    | Directeur Général   |
--   | demo.dga@agro-expertise.com         | Demo@2026    | Directeur Général Adjoint |
--   | demo.ppv@agro-expertise.com         | Demo@2026    | PPV (pharmacie)     |
--   | technicien.pharma@agro-expertise.com| Demo@2026    | Technicien pharmacie|
--
-- SÉCURITÉ : changer ces mots de passe dès la mise en production.
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Comptes utilisateurs (mot de passe haché en bcrypt, coût 10)
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0001', 'ADMIN', 'Système', 'admin@agro-expertise.com', '+228 90 00 00 01',
       '$2b$10$PxjtCxBbh8p5mj8JR/1gOusKCwcCoPRVoA/c/NNHJe7kkrr9eGv8m',
       (SELECT id FROM departements WHERE code = 'DG'),
       'Administrateur Système', 'ACTIF', TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'admin@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0002', 'KOSSI', 'Ama', 'demo.dga@agro-expertise.com', '+228 90 00 00 02',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'DGA'),
       'Directeur Général Adjoint', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.dga@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0003', 'MENSAH', 'Kofi', 'technicien.pharma@agro-expertise.com', '+228 90 00 00 03',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'PHARMA_TECH'),
       'Technicien Pharmacie', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'technicien.pharma@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0004', 'DOSSEH', 'Kodjo', 'demo.dg@agro-expertise.com', '+228 90 00 00 04',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'DG'),
       'Directeur Général', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.dg@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0005', 'AGBEKO', 'Yawa', 'demo.ppv@agro-expertise.com', '+228 90 00 00 05',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'PPV'),
       'PPV - Regisseur Pharmacie', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.ppv@agro-expertise.com');

-- -----------------------------------------------------------------------------
-- 2. Affectation des rôles
-- -----------------------------------------------------------------------------
WITH affectations (email, role_code) AS (VALUES
  ('admin@agro-expertise.com',             'SUPER_ADMIN'),
  ('demo.dg@agro-expertise.com',           'DG'),
  ('demo.ppv@agro-expertise.com',          'PPV'),
  ('demo.dga@agro-expertise.com',          'DGA'),
  ('technicien.pharma@agro-expertise.com', 'TECHNICIEN')
)
INSERT INTO utilisateurs_roles (utilisateur_id, role_id)
SELECT u.id, r.id
FROM affectations a
JOIN utilisateurs u ON lower(u.email) = a.email
JOIN roles r        ON r.code = a.role_code
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Département principal de chaque utilisateur (table d'affectation multiple)
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs_departements (utilisateur_id, departement_id, principal)
SELECT u.id, u.departement_id, TRUE
FROM utilisateurs u
WHERE u.departement_id IS NOT NULL
ON CONFLICT DO NOTHING;