-- =============================================================================
-- GAE - ERP : 57_roles_veterinaires.sql
-- Deux roles medicaux manquants au module Clinique :
--
--   * VETERINAIRE            « Docteur Vétérinaire »
--       consulte, prescrit et APPROUVE les ordonnances : sa propre prescription
--       engage la clinique et part directement en pharmacie.
--
--   * ASSISTANT_VETERINAIRE  « Assistant Vétérinaire »
--       consulte (examens cliniques, diagnostics, paraclinique, proposition
--       d'ordonnance) mais n'approuve pas : toute ordonnance qu'il emet est une
--       PROPOSITION qui doit etre approuvee - ou ajustee puis approuvee - par le
--       Docteur veterinaire avant d'etre servie en pharmacie.
--
-- Perimetres :
--   VETERINAIRE           : tout le module clinique, SAUF la revision du tarif
--                           de consultation (`clinique.frais.update`, reservee a
--                           la Direction et au Directeur Technique) ;
--   ASSISTANT_VETERINAIRE : consultation et prescription, sans enregistrement du
--                           passage a l'accueil (`consultations.create`), sans
--                           encaissement de facture et sans approbation.
--
-- Le controle « approuvee ou ajustee puis approuvee avant service » est applique
-- par l'API : une proposition (BROUILLON) ne sort jamais vers la pharmacie et
-- aucune vente ne peut etre faite sur elle (ordonnances.service.js,
-- ventes.service.js).
-- A executer APRES 56_ordonnances_validation.sql (idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Roles metier (non systeme : modifiables par l'IAM).
-- -----------------------------------------------------------------------------
INSERT INTO roles (code, nom, description, departement_id, niveau, systeme) VALUES
  ('VETERINAIRE', 'Docteur Vétérinaire',
   'Vétérinaire praticien : consulte, prescrit et approuve les ordonnances',
   (SELECT id FROM departements WHERE code = 'DT'), 15, FALSE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, nom, description, departement_id, niveau, systeme) VALUES
  ('ASSISTANT_VETERINAIRE', 'Assistant Vétérinaire',
   'Assistant vétérinaire : consulte et propose les ordonnances (approbation par le Docteur vétérinaire)',
   (SELECT id FROM departements WHERE code = 'CLIN'), 40, FALSE)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permissions : Docteur Vétérinaire.
-- Tout le module clinique, moins la revision du tarif de consultation, qui reste
-- l'apanage de la Direction (DG, DGA) et du Directeur Technique.
-- -----------------------------------------------------------------------------
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.module = 'clinique'
WHERE r.code = 'VETERINAIRE'
  AND p.code <> 'clinique.frais.update'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permissions : Assistant Vétérinaire.
-- Il mene la consultation et propose l'ordonnance ; il n'approuve pas
-- (`clinique.ordonnances.approve` absent), ne sert pas l'ordonnance
-- (`clinique.ordonnances.validate` absent) et n'encaisse pas de facture
-- (`clinique.factures.validate` absent).
-- -----------------------------------------------------------------------------
WITH attributions (permissions) AS (VALUES (ARRAY[
  'clinique.consultations.read',
  'clinique.consultations.update',
  'clinique.consultations.validate',
  'clinique.examens.read',
  'clinique.examens.create',
  'clinique.examens.update',
  'clinique.paracliniques.read',
  'clinique.paracliniques.create',
  'clinique.ordonnances.read',
  'clinique.ordonnances.create',
  'clinique.ordonnances.update',
  'clinique.animaux.read',
  'clinique.animaux.create',
  'clinique.animaux.update',
  'clinique.proprietaires.read',
  'clinique.referentiels.read',
  'clinique.factures.read',
  'clinique.rapports.read'
]))
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = 'ASSISTANT_VETERINAIRE'
JOIN permissions p ON p.code = ANY (a.permissions)
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- Comptes de demonstration (mot de passe Demo@2026, comme les autres comptes
-- « demo.* »). A supprimer ou desactiver en production.
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut)
SELECT 'GAE-0010', 'KOUDJO', 'Sena', 'demo.veto@agro-expertise.com', '+228 90 00 00 10',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'DT'),
       'Docteur Vétérinaire', 'ACTIF'
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.veto@agro-expertise.com');

INSERT INTO utilisateurs (matricule, nom, prenom, email, telephone, mot_de_passe_hash,
                          departement_id, fonction, statut)
SELECT 'GAE-0011', 'GBEKOU', 'Rita', 'demo.assistant.veto@agro-expertise.com', '+228 90 00 00 11',
       '$2b$10$RXNj6/IzT2deO2OroGGtRepqHLbVZ.WJciLRT8gTwjYlHk34TkjKe',
       (SELECT id FROM departements WHERE code = 'CLIN'),
       'Assistant Vétérinaire', 'ACTIF'
WHERE NOT EXISTS (SELECT 1 FROM utilisateurs WHERE lower(email) = 'demo.assistant.veto@agro-expertise.com');

WITH comptes (email, role_code) AS (VALUES
  ('demo.veto@agro-expertise.com',           'VETERINAIRE'),
  ('demo.assistant.veto@agro-expertise.com', 'ASSISTANT_VETERINAIRE')
)
INSERT INTO utilisateurs_roles (utilisateur_id, role_id)
SELECT u.id, r.id
FROM comptes c
JOIN utilisateurs u ON lower(u.email) = c.email
JOIN roles r        ON r.code = c.role_code
ON CONFLICT DO NOTHING;

-- Controle rapide (decommenter au besoin) :
-- SELECT r.code, r.nom, count(rp.permission_id) AS nb_permissions
-- FROM roles r
-- LEFT JOIN roles_permissions rp ON rp.role_id = r.id
-- WHERE r.code IN ('VETERINAIRE', 'ASSISTANT_VETERINAIRE')
-- GROUP BY r.code, r.nom;
-- SELECT p.code FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE r.code = 'ASSISTANT_VETERINAIRE' ORDER BY p.code;
