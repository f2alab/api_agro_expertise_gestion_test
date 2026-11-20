-- =============================================================================
-- GAE - ERP : 03_seed_organigramme.sql
-- Organigramme du Groupe Agro-Expertise (données de référence).
-- Ordre d'insertion : les parents doivent exister avant les enfants.
-- =============================================================================

SET client_encoding = 'UTF8';

-- Niveau 1 : Direction Générale
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('DG', 'Direction Générale', 'Direction Générale du Groupe Agro-Expertise', NULL, 'DIRECTION', 'Lomé', 1);

-- Niveau 2
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('DGA',  'Direction Générale Adjointe', 'Assiste la Direction Générale', (SELECT id FROM departements WHERE code = 'DG'), 'DIRECTION', 'Lomé', 1),
('FORM', 'Formations', 'Service formations du groupe', (SELECT id FROM departements WHERE code = 'DG'), 'DEPARTEMENT', 'Lomé', 2),
('RDN',  'RDN', 'Service RDN', (SELECT id FROM departements WHERE code = 'DG'), 'DEPARTEMENT', 'Lomé', 3),
('DT',   'Direction Technique', 'Direction technique et vétérinaire', (SELECT id FROM departements WHERE code = 'DG'), 'DIRECTION', 'Lomé', 4);

-- Niveau 3 : rattachés à la DGA
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('TRESO',  'Trésorerie', 'Trésorerie du groupe', (SELECT id FROM departements WHERE code = 'DGA'), 'SERVICE', 'Lomé', 1),
('COMPTA', 'Comptabilité & Inventaires', 'Comptabilité et gestion des inventaires', (SELECT id FROM departements WHERE code = 'DGA'), 'SERVICE', 'Lomé', 2),
('COMM',   'Service Commercial', 'Ventes et relation clients', (SELECT id FROM departements WHERE code = 'DGA'), 'SERVICE', 'Lomé', 3),
('HYG',    'Hyg Env hôt & Hospi', 'Pôle hygiène et hospitalité', (SELECT id FROM departements WHERE code = 'DGA'), 'DEPARTEMENT', 'Lomé', 4);

-- Niveau 4 : pôle Hygiène
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('HYG_TECH', 'Techniciens Hygiène', 'Équipe technique hygiène', (SELECT id FROM departements WHERE code = 'HYG'), 'UNITE', 'Lomé', 1);

-- Niveau 5 : stagiaires hygiène
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('HYG_STAG', 'Stagiaires Hygiène', 'Stagiaires du pôle hygiène', (SELECT id FROM departements WHERE code = 'HYG_TECH'), 'UNITE', 'Lomé', 1);

-- Niveau 3 : rattachés à la Direction Technique
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('CLIN',   'Clinique', 'Clinique vétérinaire', (SELECT id FROM departements WHERE code = 'DT'), 'DEPARTEMENT', 'Lomé', 1),
('PHARMA', 'Pharmacie', 'Pharmacie vétérinaire', (SELECT id FROM departements WHERE code = 'DT'), 'DEPARTEMENT', 'Lomé', 2),
('ZOO',    'Suivi Zoo Sanitaire', 'Suivi zoosanitaire des élevages', (SELECT id FROM departements WHERE code = 'DT'), 'SERVICE', 'Lomé', 3),
('AMEL',   'Amélioration Génétique', 'Programmes d''amélioration génétique', (SELECT id FROM departements WHERE code = 'DT'), 'SERVICE', 'Lomé', 4),
('PARA',   'Paraclinique', 'Examens paracliniques et laboratoire', (SELECT id FROM departements WHERE code = 'DT'), 'SERVICE', 'Lomé', 5);

-- Niveau 4 : unités opérationnelles
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('CLIN_TECH',   'Techniciens Clinique', 'Techniciens de la clinique', (SELECT id FROM departements WHERE code = 'CLIN'), 'UNITE', 'Lomé', 1),
('PHARMA_SUCC', 'Succursales Pharmacie', 'Réseau de succursales de la pharmacie', (SELECT id FROM departements WHERE code = 'PHARMA'), 'SUCCURSALE', 'Togo', 1),
('ZOO_TECH',    'Techniciens Zoo Sanitaire', 'Techniciens du suivi zoosanitaire', (SELECT id FROM departements WHERE code = 'ZOO'), 'UNITE', 'Lomé', 1),
('AMEL_TECH',   'Techniciens Amélioration Génétique', 'Techniciens du programme génétique', (SELECT id FROM departements WHERE code = 'AMEL'), 'UNITE', 'Lomé', 1),
('PARA_TECH',   'Techniciens Paraclinique', 'Techniciens du laboratoire', (SELECT id FROM departements WHERE code = 'PARA'), 'UNITE', 'Lomé', 1);

-- Niveau 5 : techniciens des succursales pharmacie
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('PHARMA_TECH', 'Techniciens Pharmacie', 'Techniciens des succursales pharmacie', (SELECT id FROM departements WHERE code = 'PHARMA_SUCC'), 'UNITE', 'Togo', 1);

-- Niveau 6 : para-professionnels vétérinaires régisseurs (sous les techniciens pharmacie)
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('PPV', 'Para-professionnel Vétérinaire Régisseur', 'Para-professionnels vétérinaires régisseurs des succursales pharmacie', (SELECT id FROM departements WHERE code = 'PHARMA_TECH'), 'UNITE', 'Togo', 1);

-- Niveau 7 : stagiaires pharmacie (sous les PPV)
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('PHARMA_STAG', 'Stagiaires Pharmacie', 'Stagiaires de la pharmacie', (SELECT id FROM departements WHERE code = 'PPV'), 'UNITE', 'Togo', 1);

-- Niveau 6 : stagiaires des autres unités techniques
INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre) VALUES
('CLIN_STAG',   'Stagiaires Clinique', 'Stagiaires de la clinique', (SELECT id FROM departements WHERE code = 'CLIN_TECH'), 'UNITE', 'Lomé', 1),
('ZOO_STAG',    'Stagiaires Zoo Sanitaire', 'Stagiaires du suivi zoosanitaire', (SELECT id FROM departements WHERE code = 'ZOO_TECH'), 'UNITE', 'Lomé', 1),
('AMEL_STAG',   'Stagiaires Amélioration Génétique', 'Stagiaires du programme génétique', (SELECT id FROM departements WHERE code = 'AMEL_TECH'), 'UNITE', 'Lomé', 1),
('PARA_STAG',   'Stagiaires Paraclinique', 'Stagiaires du laboratoire', (SELECT id FROM departements WHERE code = 'PARA_TECH'), 'UNITE', 'Lomé', 1);

-- Recalcul des chemins matérialisés et des niveaux (source de vérité : parent_id)
UPDATE departements d
SET chemin = a.chemin,
    niveau = a.niveau
FROM fn_arbre_departements() a
WHERE a.id = d.id;