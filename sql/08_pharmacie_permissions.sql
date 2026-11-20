-- Module Pharmacie : permission du catalogue + role PPV + re-attribution RBAC.
-- A executer APRES 04_seed_permissions_roles.sql.
-- Le catalogue 04 pre-declarait deja une partie des droits pharmacie.* ; ce
-- fichier complete la liste et redistribue les droits aux roles existants.

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Permissions complementaires du module Pharmacie
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
('pharmacie.points.read',        'pharmacie', 'points',       'read',     'Consulter les points de vente', 'Lister les pharmacies (siege, succursales)'),
('pharmacie.points.create',      'pharmacie', 'points',       'create',   'Creer un point de vente',       'Ajouter une pharmacie au reseau'),
('pharmacie.points.update',      'pharmacie', 'points',       'update',   'Modifier un point de vente',    'Mettre a jour les informations d''une pharmacie'),
('pharmacie.points.delete',      'pharmacie', 'points',       'delete',   'Desactiver un point de vente',  'Desactiver une pharmacie du reseau'),
('pharmacie.produits.read',      'pharmacie', 'produits',     'read',     'Consulter les produits',        'Acceder au referentiel des produits'),
('pharmacie.produits.create',    'pharmacie', 'produits',     'create',   'Creer un produit',              'Ajouter un produit au referentiel'),
('pharmacie.produits.update',    'pharmacie', 'produits',     'update',   'Modifier un produit',           'Modifier un produit ou son parametrage local'),
('pharmacie.produits.delete',    'pharmacie', 'produits',     'delete',   'Desactiver un produit',         'Retirer un produit du referentiel'),
('pharmacie.fournisseurs.read',  'pharmacie', 'fournisseurs', 'read',     'Consulter les fournisseurs',    'Acceder au fichier fournisseurs'),
('pharmacie.fournisseurs.create','pharmacie', 'fournisseurs', 'create',   'Creer un fournisseur',          'Enregistrer un nouveau fournisseur'),
('pharmacie.fournisseurs.update','pharmacie', 'fournisseurs', 'update',   'Modifier un fournisseur',       'Mettre a jour un fournisseur'),
('pharmacie.fournisseurs.delete','pharmacie', 'fournisseurs', 'delete',   'Desactiver un fournisseur',     'Desactiver un fournisseur'),
('pharmacie.commandes.read',     'pharmacie', 'commandes',    'read',     'Consulter les commandes',       'Acceder aux commandes d''approvisionnement'),
('pharmacie.commandes.create',   'pharmacie', 'commandes',    'create',   'Creer une commande',            'Saisir une commande fournisseur'),
('pharmacie.commandes.update',   'pharmacie', 'commandes',    'update',   'Modifier une commande',         'Mettre a jour une commande'),
('pharmacie.commandes.validate', 'pharmacie', 'commandes',    'validate', 'Receptionner une commande',     'Valider une reception et entrer le stock'),
('pharmacie.stocks.export',      'pharmacie', 'stocks',       'export',   'Exporter les stocks',           'Exporter les mouvements et la valorisation'),
('pharmacie.inventaires.read',   'pharmacie', 'inventaires',  'read',     'Consulter les inventaires',     'Acceder aux sessions d''inventaire'),
('pharmacie.inventaires.create', 'pharmacie', 'inventaires',  'create',   'Ouvrir un inventaire',          'Demarrer une session d''inventaire'),
('pharmacie.inventaires.validate','pharmacie','inventaires',  'validate', 'Valider un inventaire',         'Cloturer et valider les ecarts d''inventaire'),
('pharmacie.inventaires.export', 'pharmacie', 'inventaires',  'export',   'Exporter les inventaires',      'Exporter les feuilles d''inventaire'),
('pharmacie.ventes.validate',    'pharmacie', 'ventes',       'validate', 'Annuler une vente',             'Annuler une vente et remettre le stock'),
('pharmacie.ventes.export',      'pharmacie', 'ventes',       'export',   'Exporter les ventes',           'Exporter les journaux de vente'),
('pharmacie.finance.read',       'pharmacie', 'finance',      'read',     'Consulter la finance pharmacie','Acceder aux indicateurs financiers de la pharmacie'),
('pharmacie.finance.export',     'pharmacie', 'finance',      'export',   'Exporter la finance pharmacie', 'Exporter les rapports financiers de la pharmacie')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Role Para-professionnel Veterinaire Regisseur (PPV)
-- Vente au comptoir et lecture du stock de son point de vente.
-- -----------------------------------------------------------------------------
INSERT INTO roles (code, nom, description, departement_id, niveau, systeme) VALUES
('PPV', 'Para-professionnel Veterinaire Regisseur',
 'Vente et gestion courante du stock de la pharmacie',
 (SELECT id FROM departements WHERE code = 'PPV'), 55, FALSE)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. (Re)attribution des permissions aux roles
-- Memes motifs que 04_seed_permissions_roles.sql, plus le role PPV. L'insertion
-- est idempotente (ON CONFLICT DO NOTHING) : rejouer cette section ne fait
-- qu'ajouter les droits nouvellement declares.
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
  ('COMPTABLE',        ARRAY['finance.%', 'pharmacie.stocks.read', 'pharmacie.finance.read', 'iam.departments.read', 'direction.rapports.read']),
  ('RESP_COMMERCIAL',  ARRAY['commercial.%', 'pharmacie.ventes.%', 'direction.rapports.read']),
  ('RESP_HYGIENE',     ARRAY['hygiene.%', 'direction.rapports.read']),
  ('RESP_FORMATION',   ARRAY['formation.%', 'direction.rapports.read']),
  ('CHARGE_RDN',       ARRAY['direction.rapports.read', 'clinique.%.read', 'laboratoire.%.read']),
  ('TECHNICIEN',       ARRAY[
      'clinique.animaux.read', 'clinique.consultations.read', 'clinique.consultations.create',
      'laboratoire.analyses.read', 'laboratoire.analyses.create',
      'pharmacie.stocks.read', 'pharmacie.produits.read', 'pharmacie.ventes.read', 'pharmacie.ventes.create',
      'hygiene.interventions.read']),
  ('PPV',              ARRAY['pharmacie.ventes.%', 'pharmacie.stocks.read', 'pharmacie.produits.read', 'pharmacie.points.read']),
  ('STAGIAIRE',        ARRAY['clinique.animaux.read', 'clinique.consultations.read',
                             'pharmacie.stocks.read', 'pharmacie.produits.read', 'formation.sessions.read']),
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

-- Verification rapide : nombre de permissions pharmacie par role
-- SELECT r.code, count(rp.permission_id) AS nb_pharmacie
-- FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id AND p.module = 'pharmacie'
-- GROUP BY r.code ORDER BY r.code;

-- -----------------------------------------------------------------------------
-- 4. Rattachement des comptes de demonstration au role PPV
-- Le role PPV est cree ICI, apres le seed des utilisateurs (05) : l'affectation
-- des roles de 05 ne peut donc pas le prendre en compte. On la complète ici.
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs_roles (utilisateur_id, role_id)
SELECT u.id, r.id
FROM utilisateurs u, roles r
WHERE lower(u.email) = 'demo.ppv@agro-expertise.com'
  AND r.code = 'PPV'
ON CONFLICT DO NOTHING;