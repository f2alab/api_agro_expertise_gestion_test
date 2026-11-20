-- =============================================================================
-- GAE - ERP : 35_pharmacie_rapports.sql
-- Rapports de la pharmacie : situation journaliere (ou par periode) des ventes
-- et de la caisse, par point de vente ou pour tout le reseau.
--
--   * `pharmacie.rapports.read`   : generer / consulter la situation (API
--                                   GET /api/pharmacie/rapports/situation) ;
--   * `pharmacie.rapports.export` : exporter et imprimer le document
--                                   (CSV, PV / PDF) ;
--   * index d'aide au rapport de caisse (point + date).
--
-- Cloisonnement : les permissions ouvrent l'ecran, le PERIMETRE restreint les
-- donnees (voir utils/perimetre.js). Un PPV ou un responsable de pharmacie ne
-- peut donc generer la situation que pour sa pharmacie de rattachement ; le DG,
-- le DGA, le Directeur technique, le Comptable et le Tresorier generent pour
-- chaque pharmacie ou pour l'ensemble du reseau (pointId absent).
--
-- A executer APRES 34_referentiels_formes.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Permissions du module (catalogue)
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('pharmacie.rapports.read',   'pharmacie', 'rapports', 'read',
   'Consulter les rapports de vente', 'Generer la situation journaliere ou par periode des ventes et de la caisse'),
  ('pharmacie.rapports.export', 'pharmacie', 'rapports', 'export',
   'Exporter les rapports de vente', 'Exporter, imprimer ou archiver la situation des ventes et de la caisse (CSV, PV / PDF)')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Attribution aux roles
-- Memes motifs que 08_pharmacie_permissions.sql : « pharmacie.% » couvre les
-- responsables de pharmacie et la direction technique ; la direction (DG, DGA),
-- le comptable et le tresorier regoivent les deux droits ; l'auditeur dispose de
-- la lecture seule ; le PPV genere pour son seul point de vente.
-- -----------------------------------------------------------------------------
WITH attributions (role_code, motifs) AS (VALUES
  ('SUPER_ADMIN',     ARRAY['%']),
  ('DG',              ARRAY['pharmacie.rapports.%']),
  ('DGA',             ARRAY['pharmacie.rapports.%']),
  ('DIR_TECHNIQUE',   ARRAY['pharmacie.%']),
  ('RESP_PHARMACIE',  ARRAY['pharmacie.%']),
  ('COMPTABLE',       ARRAY['pharmacie.rapports.%']),
  ('TRESORIER',       ARRAY['pharmacie.rapports.%']),
  ('AUDITEUR',        ARRAY['pharmacie.rapports.read']),
  ('PPV',             ARRAY['pharmacie.rapports.%'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON EXISTS (
  SELECT 1 FROM unnest(a.motifs) AS m(motif) WHERE p.code LIKE m.motif
)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Index d'aide au rapport de situation
-- Le rapport agrege les ventes et les flux de caisse « par pharmacie et par
-- jour » : ces index composites evitent un parcours complet des tables.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_point_date
  ON pharmacie_ventes(point_id, date_vente DESC);

CREATE INDEX IF NOT EXISTS idx_finance_tx_point_date
  ON finance_transactions(point_id, date_transaction DESC);

CREATE INDEX IF NOT EXISTS idx_finance_depenses_point_date
  ON finance_depenses(point_id, date_depense DESC)
  WHERE statut = 'VALIDEE';
