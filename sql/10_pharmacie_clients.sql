-- Module Pharmacie : clients (acheteurs) et rattachement des ventes.
-- A executer APRES 09_pharmacie_seed.sql. Idempotent : peut etre rejoue.

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Table : pharmacie_clients
-- Fichier clients partage par les points de vente. La suppression est logique
-- (actif = FALSE) afin de conserver l'historique des ventes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacie_clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        VARCHAR(150) NOT NULL,
  telephone  VARCHAR(30),
  email      VARCHAR(180),
  adresse    VARCHAR(200),
  actif      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pharmacie_clients IS 'Clients de la pharmacie (acheteurs).';

CREATE INDEX IF NOT EXISTS idx_pharmacie_clients_nom ON pharmacie_clients(nom);
CREATE INDEX IF NOT EXISTS idx_pharmacie_clients_telephone ON pharmacie_clients(telephone);

-- Rattachement optionnel d'une vente a un client enregistre.
ALTER TABLE pharmacie_ventes
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES pharmacie_clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_client ON pharmacie_ventes(client_id);

DROP TRIGGER IF EXISTS trg_pharmacie_clients_maj ON pharmacie_clients;
CREATE TRIGGER trg_pharmacie_clients_maj BEFORE UPDATE ON pharmacie_clients
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();

-- -----------------------------------------------------------------------------
-- Permissions du module Clients
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
('pharmacie.clients.read',   'pharmacie', 'clients', 'read',   'Consulter les clients', 'Acceder au fichier clients de la pharmacie'),
('pharmacie.clients.create', 'pharmacie', 'clients', 'create', 'Creer un client',       'Enregistrer un nouveau client'),
('pharmacie.clients.update', 'pharmacie', 'clients', 'update', 'Modifier un client',    'Mettre a jour une fiche client'),
('pharmacie.clients.delete', 'pharmacie', 'clients', 'delete', 'Supprimer un client',   'Desactiver un client')
ON CONFLICT (code) DO NOTHING;

-- Attribution ciblee des nouvelles permissions aux roles concernes.
WITH attributions (role_code, permission_code) AS (VALUES
  ('RESP_PHARMACIE', 'pharmacie.clients.read'),
  ('RESP_PHARMACIE', 'pharmacie.clients.create'),
  ('RESP_PHARMACIE', 'pharmacie.clients.update'),
  ('RESP_PHARMACIE', 'pharmacie.clients.delete'),
  ('DIR_TECHNIQUE',  'pharmacie.clients.read'),
  ('DIR_TECHNIQUE',  'pharmacie.clients.create'),
  ('DIR_TECHNIQUE',  'pharmacie.clients.update'),
  ('DIR_TECHNIQUE',  'pharmacie.clients.delete'),
  ('PPV',            'pharmacie.clients.read'),
  ('PPV',            'pharmacie.clients.create'),
  ('PPV',            'pharmacie.clients.update'),
  ('TECHNICIEN',     'pharmacie.clients.read'),
  ('RESP_COMMERCIAL','pharmacie.clients.read'),
  ('RESP_COMMERCIAL','pharmacie.clients.create'),
  ('DG',             'pharmacie.clients.read'),
  ('DGA',            'pharmacie.clients.read'),
  ('AUDITEUR',       'pharmacie.clients.read'),
  ('COMPTABLE',      'pharmacie.clients.read')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = a.permission_code
ON CONFLICT DO NOTHING;