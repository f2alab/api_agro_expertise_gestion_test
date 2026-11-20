-- =============================================================================
-- GAE - ERP : 50_clinique_seed.sql
-- Référentiels de démarrage du module Clinique : espèces, appareils/organes,
-- types d'examen paraclinique et motifs de consultation fréquents.
-- A executer APRES 49_clinique_permissions.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Espèces suivies par la clinique
-- -----------------------------------------------------------------------------
INSERT INTO clinique_referentiels (type, code, libelle, ordre) VALUES
  ('ESPECE', 'BOVIN',       'Bovin',        1),
  ('ESPECE', 'OVIN',        'Ovin',         2),
  ('ESPECE', 'CAPRIN',      'Caprin',       3),
  ('ESPECE', 'PORCIN',      'Porcin',       4),
  ('ESPECE', 'VOLAILLE',    'Volaille',     5),
  ('ESPECE', 'CANIN',       'Chien',        6),
  ('ESPECE', 'FELIN',       'Chat',         7),
  ('ESPECE', 'EQUIN',       'Équin',        8),
  ('ESPECE', 'LAPIN',       'Lapin',        9),
  ('ESPECE', 'AQUACULTURE', 'Poisson / aquaculture', 10),
  ('ESPECE', 'AUTRE',       'Autre espèce', 99)
ON CONFLICT (type, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Appareils / organes examinés lors de l'examen rapproché
-- -----------------------------------------------------------------------------
INSERT INTO clinique_referentiels (type, code, libelle, ordre) VALUES
  ('ORGANE', 'CARDIO_VASCULAIRE', 'Appareil cardio-vasculaire', 1),
  ('ORGANE', 'RESPIRATOIRE',      'Appareil respiratoire',      2),
  ('ORGANE', 'DIGESTIF',          'Appareil digestif',          3),
  ('ORGANE', 'URO_GENITAL',       'Appareil uro-génital',       4),
  ('ORGANE', 'LOCOMOTEUR',        'Appareil locomoteur',        5),
  ('ORGANE', 'NERVEUX',           'Système nerveux',            6),
  ('ORGANE', 'TEGUMENTAIRE',      'Peau et phanères',           7),
  ('ORGANE', 'OCULAIRE',          'Œil et annexes',             8),
  ('ORGANE', 'ORL',               'Oreilles, nez, gorge',       9),
  ('ORGANE', 'GANGLIONNAIRE',     'Ganglions lymphatiques',    10),
  ('ORGANE', 'MAMELLE',           'Mamelle',                   11)
ON CONFLICT (type, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Types d'examen paraclinique
-- -----------------------------------------------------------------------------
INSERT INTO clinique_referentiels (type, code, libelle, ordre) VALUES
  ('EXAMEN_PARACLINIQUE', 'IMAGERIE',       'Imagerie',                 1),
  ('EXAMEN_PARACLINIQUE', 'RADIOGRAPHIE',   'Radiographie',             2),
  ('EXAMEN_PARACLINIQUE', 'ECHOGRAPHIE',    'Échographie',              3),
  ('EXAMEN_PARACLINIQUE', 'PRELEVEMENT',    'Prélèvement',              4),
  ('EXAMEN_PARACLINIQUE', 'HEMATOLOGIE',    'Hématologie',              5),
  ('EXAMEN_PARACLINIQUE', 'BIOCHIMIE',      'Biochimie',                6),
  ('EXAMEN_PARACLINIQUE', 'COPROLOGIE',     'Coprologie',               7),
  ('EXAMEN_PARACLINIQUE', 'SEROLOGIE',      'Sérologie',                8),
  ('EXAMEN_PARACLINIQUE', 'URINE',          'Analyse d''urine',         9),
  ('EXAMEN_PARACLINIQUE', 'AUTRE',          'Autre examen',            99)
ON CONFLICT (type, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Motifs de consultation fréquents (saisie rapide à l'accueil)
-- -----------------------------------------------------------------------------
INSERT INTO clinique_referentiels (type, code, libelle, ordre) VALUES
  ('MOTIF', 'FIEVRE',           'Fièvre',                    1),
  ('MOTIF', 'DIARRHEE',         'Diarrhée',                  2),
  ('MOTIF', 'VOMISSEMENT',      'Vomissement',               3),
  ('MOTIF', 'ANOREXIE',         'Anorexie / refus de manger',4),
  ('MOTIF', 'BOITERIE',         'Boiterie',                  5),
  ('MOTIF', 'TOUX',             'Toux',                      6),
  ('MOTIF', 'ECOULEMENT_NASAL', 'Écoulement nasal',          7),
  ('MOTIF', 'PLAIE',            'Plaie / blessure',          8),
  ('MOTIF', 'CHUTE_PRODUCTION', 'Chute de production',       9),
  ('MOTIF', 'VACCINATION',      'Vaccination',              10),
  ('MOTIF', 'CASTRATION',       'Castration',               11),
  ('MOTIF', 'GESTATION',        'Suivi de gestation',       12),
  ('MOTIF', 'CONTROLE',         'Consultation de contrôle', 13),
  ('MOTIF', 'AUTRE',            'Autre motif',              99)
ON CONFLICT (type, code) DO NOTHING;