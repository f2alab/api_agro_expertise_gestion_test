-- =============================================================================
-- GAE - ERP : 04_seed_permissions_roles.sql
-- Catalogue des permissions + rôles métier + affectation des permissions.
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Catalogue des permissions
--    Module IAM : socle de sécurité utilisé par l'ensemble de la plateforme.
--    Les permissions des modules métier (clinique, laboratoire, pharmacie,
--    finance, commercial, direction, formation, hygiène) sont pré-déclarées :
--    les futurs modules n'auront qu'à les consommer.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
-- Module IAM -------------------------------------------------------------
('iam.users.read',        'iam', 'users',       'read',    'Consulter les utilisateurs',   'Lister et consulter les comptes utilisateurs'),
('iam.users.create',      'iam', 'users',       'create',  'Créer un utilisateur',         'Créer un nouveau compte utilisateur'),
('iam.users.update',      'iam', 'users',       'update',  'Modifier un utilisateur',      'Modifier les informations d''un compte'),
('iam.users.delete',      'iam', 'users',       'delete',  'Désactiver un utilisateur',    'Désactiver ou archiver un compte'),
('iam.roles.read',        'iam', 'roles',       'read',    'Consulter les rôles',          'Lister et consulter les rôles'),
('iam.roles.create',      'iam', 'roles',       'create',  'Créer un rôle',                'Créer un rôle métier'),
('iam.roles.update',      'iam', 'roles',       'update',  'Modifier un rôle',             'Modifier un rôle métier'),
('iam.roles.delete',      'iam', 'roles',       'delete',  'Supprimer un rôle',            'Supprimer un rôle non système'),
('iam.roles.assign',      'iam', 'roles',       'assign',  'Affecter des rôles',           'Affecter rôles aux utilisateurs et permissions aux rôles'),
('iam.permissions.read',  'iam', 'permissions', 'read',    'Consulter les permissions',    'Lister le catalogue des permissions'),
('iam.departments.read',  'iam', 'departments', 'read',    'Consulter l''organigramme',    'Lister les directions, services et succursales'),
('iam.departments.create','iam', 'departments', 'create',  'Créer un département',         'Créer une direction, un service ou une succursale'),
('iam.departments.update','iam', 'departments', 'update',  'Modifier un département',      'Modifier une structure de l''organigramme'),
('iam.departments.delete','iam', 'departments', 'delete',  'Supprimer un département',     'Supprimer une structure sans utilisateur rattaché'),
('iam.sessions.read',     'iam', 'sessions',    'read',    'Consulter les sessions',       'Voir les sessions actives des utilisateurs'),
('iam.sessions.manage',   'iam', 'sessions',    'manage',  'Révoquer des sessions',        'Déconnecter un utilisateur à distance'),
('iam.audit.read',        'iam', 'audit',       'read',    'Consulter le journal d''audit','Lire la traçabilité des actions'),
('iam.audit.export',      'iam', 'audit',       'export',  'Exporter le journal d''audit', 'Exporter la traçabilité (CSV)'),
-- Module Clinique --------------------------------------------------------
('clinique.animaux.read',          'clinique', 'animaux',       'read',     'Consulter les animaux',       'Accéder aux fiches animaux'),
('clinique.animaux.create',        'clinique', 'animaux',       'create',   'Créer une fiche animal',      'Enregistrer un nouvel animal'),
('clinique.animaux.update',        'clinique', 'animaux',       'update',   'Modifier une fiche animal',   'Mettre à jour une fiche animal'),
('clinique.consultations.read',    'clinique', 'consultations', 'read',     'Consulter les consultations', 'Accéder aux consultations'),
('clinique.consultations.create',  'clinique', 'consultations', 'create',   'Créer une consultation',      'Ouvrir une consultation'),
('clinique.consultations.validate','clinique', 'consultations', 'validate', 'Valider une consultation',    'Clôturer et valider une consultation'),
-- Module Laboratoire / Paraclinique --------------------------------------
('laboratoire.analyses.read',     'laboratoire', 'analyses', 'read',     'Consulter les analyses', 'Accéder aux demandes d''analyses'),
('laboratoire.analyses.create',   'laboratoire', 'analyses', 'create',   'Créer une analyse',      'Enregistrer une demande d''analyse'),
('laboratoire.analyses.validate', 'laboratoire', 'analyses', 'validate', 'Valider un résultat',    'Valider et publier un résultat d''analyse'),
-- Module Pharmacie -------------------------------------------------------
('pharmacie.stocks.read',     'pharmacie', 'stocks', 'read',     'Consulter les stocks',   'Accéder aux stocks des succursales'),
('pharmacie.stocks.create',   'pharmacie', 'stocks', 'create',   'Enregistrer une entrée', 'Ajouter un produit ou une entrée de stock'),
('pharmacie.stocks.update',   'pharmacie', 'stocks', 'update',   'Ajuster le stock',       'Corriger ou ajuster une quantité'),
('pharmacie.stocks.validate', 'pharmacie', 'stocks', 'validate', 'Valider un inventaire',  'Valider les mouvements et inventaires'),
('pharmacie.ventes.read',     'pharmacie', 'ventes', 'read',     'Consulter les ventes',   'Accéder aux ventes de la pharmacie'),
('pharmacie.ventes.create',   'pharmacie', 'ventes', 'create',   'Enregistrer une vente',  'Créer une vente au comptoir')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
-- Module Finance / Comptabilité ------------------------------------------
('finance.ecritures.read',     'finance', 'ecritures',  'read',     'Consulter les écritures',  'Accéder aux écritures comptables'),
('finance.ecritures.create',   'finance', 'ecritures',  'create',   'Créer une écriture',       'Saisir une écriture comptable'),
('finance.ecritures.validate', 'finance', 'ecritures',  'validate', 'Valider une écriture',     'Valider la comptabilisation'),
('finance.tresorerie.read',    'finance', 'tresorerie', 'read',     'Consulter la trésorerie',  'Accéder aux mouvements de trésorerie'),
('finance.tresorerie.manage',  'finance', 'tresorerie', 'manage',   'Gérer la trésorerie',      'Effectuer des opérations de trésorerie'),
-- Module Commercial ------------------------------------------------------
('commercial.clients.read',      'commercial', 'clients',   'read',     'Consulter les clients',   'Accéder au fichier clients'),
('commercial.clients.create',    'commercial', 'clients',   'create',   'Créer un client',         'Enregistrer un nouveau client'),
('commercial.clients.update',    'commercial', 'clients',   'update',   'Modifier un client',      'Mettre à jour une fiche client'),
('commercial.commandes.read',    'commercial', 'commandes', 'read',     'Consulter les commandes', 'Accéder aux commandes'),
('commercial.commandes.validate','commercial', 'commandes', 'validate', 'Valider une commande',    'Valider et facturer une commande'),
-- Module Direction -------------------------------------------------------
('direction.rapports.read',   'direction', 'rapports', 'read',   'Consulter les rapports', 'Accéder aux tableaux de bord consolidés'),
('direction.rapports.export', 'direction', 'rapports', 'export', 'Exporter les rapports',  'Exporter les rapports de direction'),
-- Module Formation -------------------------------------------------------
('formation.sessions.read',   'formation', 'sessions', 'read',   'Consulter les formations', 'Accéder au catalogue de formations'),
('formation.sessions.create', 'formation', 'sessions', 'create', 'Créer une formation',      'Planifier une session de formation'),
-- Module Hygiène ---------------------------------------------------------
('hygiene.interventions.read',     'hygiene', 'interventions', 'read',     'Consulter les interventions', 'Accéder aux interventions d''hygiène'),
('hygiene.interventions.create',   'hygiene', 'interventions', 'create',   'Créer une intervention',      'Planifier une intervention d''hygiène'),
('hygiene.interventions.validate', 'hygiene', 'interventions', 'validate', 'Valider une intervention',    'Valider le rapport d''intervention')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Rôles métier
--    niveau : 1 = Direction Générale ... 100 = stagiaires
-- -----------------------------------------------------------------------------
INSERT INTO roles (code, nom, description, departement_id, niveau, systeme) VALUES
('SUPER_ADMIN',      'Super Administrateur',      'Accès total à la plateforme (compte technique)', NULL, 1, TRUE),
('DG',               'Directeur Général',         'Direction Générale du groupe', (SELECT id FROM departements WHERE code = 'DG'), 1, FALSE),
('DGA',              'Directeur Général Adjoint', 'Direction Générale Adjointe', (SELECT id FROM departements WHERE code = 'DGA'), 2, FALSE),
('TRESORIER',        'Trésorier',                 'Gestion de la trésorerie', (SELECT id FROM departements WHERE code = 'TRESO'), 20, FALSE),
('COMPTABLE',        'Comptable',                 'Comptabilité et inventaires', (SELECT id FROM departements WHERE code = 'COMPTA'), 25, FALSE),
('RESP_COMMERCIAL',  'Responsable Commercial',    'Service commercial et ventes', (SELECT id FROM departements WHERE code = 'COMM'), 25, FALSE),
('RESP_HYGIENE',     'Responsable Hygiène',       'Pôle hygiène, environnement et hospitalité', (SELECT id FROM departements WHERE code = 'HYG'), 25, FALSE),
('RESP_FORMATION',   'Responsable Formations',    'Service formations', (SELECT id FROM departements WHERE code = 'FORM'), 25, FALSE),
('CHARGE_RDN',       'Chargé RDN',                'Service RDN', (SELECT id FROM departements WHERE code = 'RDN'), 25, FALSE),
('DIR_TECHNIQUE',    'Directeur Technique',       'Direction technique et vétérinaire', (SELECT id FROM departements WHERE code = 'DT'), 10, FALSE),
('RESP_CLINIQUE',    'Responsable Clinique',      'Clinique vétérinaire', (SELECT id FROM departements WHERE code = 'CLIN'), 20, FALSE),
('RESP_PHARMACIE',   'Responsable Pharmacie',     'Pharmacie et succursales', (SELECT id FROM departements WHERE code = 'PHARMA'), 20, FALSE),
('RESP_ZOO',         'Responsable Zoo Sanitaire', 'Suivi zoosanitaire', (SELECT id FROM departements WHERE code = 'ZOO'), 25, FALSE),
('RESP_AMEL',        'Responsable Amélioration Génétique', 'Programme d''amélioration génétique', (SELECT id FROM departements WHERE code = 'AMEL'), 25, FALSE),
('RESP_PARACLINIQUE','Responsable Paraclinique',  'Laboratoire et examens paracliniques', (SELECT id FROM departements WHERE code = 'PARA'), 25, FALSE),
('TECHNICIEN',       'Technicien',                'Agent technique opérationnel', NULL, 60, FALSE),
('STAGIAIRE',        'Stagiaire',                 'Stagiaire en formation', NULL, 100, FALSE),
('AUDITEUR',         'Auditeur',                  'Consultation et audit en lecture seule', NULL, 30, FALSE)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Affectation des permissions aux rôles
--    Chaque rôle reçoit les permissions dont le code correspond à l'un des motifs.
-- -----------------------------------------------------------------------------
WITH attributions (role_code, motifs) AS (VALUES
  ('SUPER_ADMIN',      ARRAY['%']),
  ('DG',               ARRAY['%.read', 'direction.rapports.export']),
  ('DGA',              ARRAY['%.read', 'direction.rapports.export']),
  ('DIR_TECHNIQUE',    ARRAY['clinique.%', 'laboratoire.%', 'pharmacie.%', 'direction.rapports.%', 'iam.departments.read']),
  ('RESP_CLINIQUE',    ARRAY['clinique.%', 'pharmacie.stocks.read', 'direction.rapports.read']),
  ('RESP_PHARMACIE',   ARRAY['pharmacie.%', 'clinique.animaux.read', 'direction.rapports.read']),
  ('RESP_ZOO',         ARRAY['clinique.animaux.%', 'clinique.consultations.read', 'direction.rapports.read']),
  ('RESP_AMEL',        ARRAY['clinique.animaux.%', 'direction.rapports.read']),
  ('RESP_PARACLINIQUE',ARRAY['laboratoire.%', 'clinique.consultations.read', 'direction.rapports.read']),
  ('TRESORIER',        ARRAY['finance.%', 'direction.rapports.read']),
  ('COMPTABLE',        ARRAY['finance.%', 'pharmacie.stocks.read', 'iam.departments.read', 'direction.rapports.read']),
  ('RESP_COMMERCIAL',  ARRAY['commercial.%', 'pharmacie.ventes.%', 'direction.rapports.read']),
  ('RESP_HYGIENE',     ARRAY['hygiene.%', 'direction.rapports.read']),
  ('RESP_FORMATION',   ARRAY['formation.%', 'direction.rapports.read']),
  ('CHARGE_RDN',       ARRAY['direction.rapports.read', 'clinique.%.read', 'laboratoire.%.read']),
  ('TECHNICIEN',       ARRAY[
      'clinique.animaux.read', 'clinique.consultations.read', 'clinique.consultations.create',
      'laboratoire.analyses.read', 'laboratoire.analyses.create',
      'pharmacie.stocks.read', 'pharmacie.ventes.read', 'pharmacie.ventes.create',
      'hygiene.interventions.read']),
  ('STAGIAIRE',        ARRAY['clinique.animaux.read', 'clinique.consultations.read',
                             'pharmacie.stocks.read', 'formation.sessions.read']),
  ('AUDITEUR',         ARRAY['%.read', 'iam.audit.export'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON EXISTS (
  SELECT 1 FROM unnest(a.motifs) AS m(motif) WHERE p.code LIKE m.motif
)
ON CONFLICT DO NOTHING;

-- Vérification rapide : nombre de permissions par rôle
-- SELECT r.code, count(rp.permission_id) AS nb_permissions
-- FROM roles r LEFT JOIN roles_permissions rp ON rp.role_id = r.id
-- GROUP BY r.code ORDER BY r.code;