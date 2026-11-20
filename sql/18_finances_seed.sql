-- =============================================================================
-- GAE - ERP : 18_finances_seed.sql
-- Données de référence du module Finance + rattachement de démonstration.
-- A exécuter APRES 17_pharmacie_isolation.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Services des activités non-pharmacie (clinique, laboratoire...)
--    Ils alimentent la vue GLOBALE de la finance du groupe.
-- -----------------------------------------------------------------------------
INSERT INTO finance_services (code, nom, type_service, departement_id, description) VALUES
('CLIN-CONSULT', 'Clinique - Consultation',          'CONSULTATION',   (SELECT id FROM departements WHERE code = 'CLIN'), 'Consultations vétérinaires'),
('CLIN-ANALYSE', 'Laboratoire - Analyse biochimique','ANALYSE',        (SELECT id FROM departements WHERE code = 'PARA'), 'Analyses biochimiques et paracliniques'),
('CLIN-HTAL',    'Clinique - Hospitalisation',       'HOSPITALISATION',(SELECT id FROM departements WHERE code = 'CLIN'), 'Hospitalisation et suivi')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Rattachement de démonstration : le compte PPV opère la pharmacie d'Agoé.
--    (En production, ce champ est renseigné à la création du compte.)
-- -----------------------------------------------------------------------------
UPDATE utilisateurs
SET point_vente_id = (SELECT id FROM pharmacie_points WHERE code = 'PH-AGOE')
WHERE lower(email) = 'demo.ppv@agro-expertise.com'
  AND point_vente_id IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Flux de démonstration (grand livre) - repérables par reference_type 'SEED'.
-- -----------------------------------------------------------------------------
-- Consultation encaissée (activité clinique, hors pharmacie)
INSERT INTO finance_transactions
  (numero, service_id, point_id, sens, categorie, mode, montant, libelle, reference_type, date_transaction)
SELECT 'SEED-TX-CONSULT', s.id, NULL, 'ENTREE', 'CONSULTATION', 'ESPECES', 15000,
       'Consultation vétérinaire (démo)', 'SEED', now() - interval '5 days'
FROM finance_services s WHERE s.code = 'CLIN-CONSULT'
ON CONFLICT (numero) DO NOTHING;

-- Analyse biochimique encaissée
INSERT INTO finance_transactions
  (numero, service_id, point_id, sens, categorie, mode, montant, libelle, reference_type, date_transaction)
SELECT 'SEED-TX-ANALYSE', s.id, NULL, 'ENTREE', 'ANALYSE', 'MOBILE_MONEY', 12000,
       'Analyse biochimique (démo)', 'SEED', now() - interval '4 days'
FROM finance_services s WHERE s.code = 'CLIN-ANALYSE'
ON CONFLICT (numero) DO NOTHING;

-- Vente comptoir de la pharmacie du siège
INSERT INTO finance_transactions
  (numero, service_id, point_id, sens, categorie, mode, montant, libelle, reference_type, date_transaction)
SELECT 'SEED-TX-VENTE', s.id, s.point_id, 'ENTREE', 'VENTE', 'ESPECES', 25000,
       'Vente comptoir (démo)', 'SEED', now() - interval '3 days'
FROM finance_services s
JOIN pharmacie_points p ON p.id = s.point_id AND p.type_point = 'SIEGE'
ON CONFLICT (numero) DO NOTHING;

-- Achat fournisseur (sortie) de la pharmacie du siège
INSERT INTO finance_transactions
  (numero, service_id, point_id, sens, categorie, mode, montant, libelle, reference_type, date_transaction)
SELECT 'SEED-TX-ACHAT', s.id, s.point_id, 'SORTIE', 'ACHAT', 'VIREMENT', 180000,
       'Approvisionnement fournisseur (démo)', 'SEED', now() - interval '6 days'
FROM finance_services s
JOIN pharmacie_points p ON p.id = s.point_id AND p.type_point = 'SIEGE'
ON CONFLICT (numero) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Dépenses de démonstration (en attente de validation) de la pharmacie du siège
-- -----------------------------------------------------------------------------
INSERT INTO finance_depenses
  (numero, service_id, point_id, categorie, libelle, beneficiaire, montant, mode, statut, date_depense)
SELECT 'SEED-DEP-001', s.id, s.point_id, 'FONCTIONNEMENT', 'Électricité', 'CEET', 45000, 'ESPECES', 'EN_ATTENTE', CURRENT_DATE
FROM finance_services s
JOIN pharmacie_points p ON p.id = s.point_id AND p.type_point = 'SIEGE'
ON CONFLICT (numero) DO NOTHING;

INSERT INTO finance_depenses
  (numero, service_id, point_id, categorie, libelle, beneficiaire, montant, mode, statut, date_depense)
SELECT 'SEED-DEP-002', s.id, s.point_id, 'TRANSPORT', 'Carburant véhicule livraison', 'Station', 30000, 'ESPECES', 'EN_ATTENTE', CURRENT_DATE
FROM finance_services s
JOIN pharmacie_points p ON p.id = s.point_id AND p.type_point = 'SIEGE'
ON CONFLICT (numero) DO NOTHING;
-- -----------------------------------------------------------------------------
-- 5. Comptes de demonstration : responsables RATTACHES a une pharmacie
--    (cloisonnement) et profils de direction a portee globale.
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, point_vente_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0006', 'ADJO', 'Kossi', 'demo.resp.pharma@agro-expertise.com', '+228 90 00 00 06',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'PHARMA'),
       (SELECT id FROM pharmacie_points WHERE code = 'PH-KPALIME'),
       'Responsable Pharmacie Kpalime', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.resp.pharma@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, point_vente_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0007', 'TCHALA', 'Afi', 'demo.dt@agro-expertise.com', '+228 90 00 00 07',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'DT'),
       NULL,
       'Directeur Technique', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.dt@agro-expertise.com');

-- Roles des nouveaux comptes (le role RESP_PHARMACIE existe deja depuis 04).
WITH affectations (email, role_code) AS (VALUES
  ('demo.resp.pharma@agro-expertise.com', 'RESP_PHARMACIE'),
  ('demo.dt@agro-expertise.com',           'DIR_TECHNIQUE')
)
INSERT INTO utilisateurs_roles (utilisateur_id, role_id)
SELECT u.id, r.id
FROM affectations a
JOIN utilisateurs u ON lower(u.email) = a.email
JOIN roles r ON r.code = a.role_code
ON CONFLICT DO NOTHING;

-- Le technicien de demonstration doit aussi avoir un perimetre (pharmacie du siege).
UPDATE utilisateurs
SET point_vente_id = (SELECT id FROM pharmacie_points WHERE code = 'PH-PRINCIPE')
WHERE lower(email) = 'technicien.pharma@agro-expertise.com'
  AND point_vente_id IS NULL;

-- Affectation principale (organigramme) des nouveaux comptes.
INSERT INTO utilisateurs_departements (utilisateur_id, departement_id, principal)
SELECT u.id, u.departement_id, TRUE
FROM utilisateurs u
WHERE lower(u.email) IN ('demo.resp.pharma@agro-expertise.com', 'demo.dt@agro-expertise.com')
  AND u.departement_id IS NOT NULL
ON CONFLICT DO NOTHING;
-- -----------------------------------------------------------------------------
-- 6. Comptes de demonstration : Tresorier et Auditeur (portee globale, lecture).
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, point_vente_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0008', 'AMOUZOU', 'Kafui', 'demo.tresorier@agro-expertise.com', '+228 90 00 00 08',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'TRESO'),
       NULL,
       'Tresorier', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.tresorier@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, point_vente_id, fonction, statut, super_admin, doit_changer_mdp)
SELECT 'GAE-0009', 'LAWSON', 'Edem', 'demo.auditeur@agro-expertise.com', '+228 90 00 00 09',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'COMPTA'),
       NULL,
       'Auditeur', 'ACTIF', FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.auditeur@agro-expertise.com');

WITH affectations (email, role_code) AS (VALUES
  ('demo.tresorier@agro-expertise.com', 'TRESORIER'),
  ('demo.auditeur@agro-expertise.com',  'AUDITEUR')
)
INSERT INTO utilisateurs_roles (utilisateur_id, role_id)
SELECT u.id, r.id
FROM affectations a
JOIN utilisateurs u ON lower(u.email) = a.email
JOIN roles r ON r.code = a.role_code
ON CONFLICT DO NOTHING;

INSERT INTO utilisateurs_departements (utilisateur_id, departement_id, principal)
SELECT u.id, u.departement_id, TRUE
FROM utilisateurs u
WHERE lower(u.email) IN ('demo.tresorier@agro-expertise.com', 'demo.auditeur@agro-expertise.com')
  AND u.departement_id IS NOT NULL
ON CONFLICT DO NOTHING;
