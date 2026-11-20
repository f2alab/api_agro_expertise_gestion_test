-- =============================================================================
-- GAE - ERP : 20_clients_fournisseurs_isolation.sql
-- Clients et fournisseurs PROPRES a chaque pharmacie (cloisonnement).
--   * pharmacie_clients.point_id      : pharmacie proprietaire du client
--   * pharmacie_fournisseurs.point_id : pharmacie proprietaire du fournisseur
-- Un compte non global ne voit/gere que les clients et fournisseurs de SA
-- pharmacie ; la direction (portee globale) voit tout et peut filtrer.
-- A executer APRES 19_temps_reel_finances.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_clients
  ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES pharmacie_points(id) ON DELETE CASCADE;

COMMENT ON COLUMN pharmacie_clients.point_id IS 'Pharmacie proprietaire du client (cloisonnement).';
CREATE INDEX IF NOT EXISTS idx_pharmacie_clients_point ON pharmacie_clients(point_id);

-- -----------------------------------------------------------------------------
-- Fournisseurs
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_fournisseurs
  ADD COLUMN IF NOT EXISTS point_id UUID REFERENCES pharmacie_points(id) ON DELETE CASCADE;

COMMENT ON COLUMN pharmacie_fournisseurs.point_id IS 'Pharmacie proprietaire du fournisseur (cloisonnement).';
CREATE INDEX IF NOT EXISTS idx_pharmacie_fournisseurs_point ON pharmacie_fournisseurs(point_id);

-- -----------------------------------------------------------------------------
-- Reprise des donnees existantes
-- -----------------------------------------------------------------------------

-- Fournisseurs INTERNES : propriete = la pharmacie destinataire (code INT-<point>).
UPDATE pharmacie_fournisseurs f
SET point_id = p.id
FROM pharmacie_points p
WHERE f.point_id IS NULL
  AND f.type_fournisseur = 'INTERNE'
  AND f.code = 'INT-' || p.code;

-- Fournisseurs EXTERNES non rattaches : rattaches a la pharmacie du siege.
UPDATE pharmacie_fournisseurs
SET point_id = (SELECT id FROM pharmacie_points WHERE type_point = 'SIEGE' ORDER BY code LIMIT 1)
WHERE point_id IS NULL
  AND type_fournisseur = 'EXTERNE';

-- Clients existants non rattaches : rattaches a la pharmacie du siege.
UPDATE pharmacie_clients
SET point_id = (SELECT id FROM pharmacie_points WHERE type_point = 'SIEGE' ORDER BY code LIMIT 1)
WHERE point_id IS NULL;
