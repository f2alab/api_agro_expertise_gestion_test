-- =============================================================================
-- GAE - ERP : 16_finances_permissions.sql
-- Permissions du module Finance (transversal) + attribution aux rôles.
-- A exécuter APRES 15_finances_schema.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Catalogue des permissions
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
('finance.services.read',        'finance', 'services',     'read',     'Consulter les services',   'Lister les services/activités générant des flux'),
('finance.transactions.read',    'finance', 'transactions', 'read',     'Consulter le grand livre', 'Accéder aux entrées/sorties d''argent'),
('finance.transactions.create',  'finance', 'transactions', 'create',   'Saisir une transaction',   'Enregistrer un mouvement d''argent (apport, transfert...)'),
('finance.depenses.read',        'finance', 'depenses',     'read',     'Consulter les dépenses',   'Accéder aux dépenses des services'),
('finance.depenses.create',      'finance', 'depenses',     'create',   'Créer une dépense',        'Saisir une dépense'),
('finance.depenses.validate',    'finance', 'depenses',     'validate', 'Valider une dépense',      'Approuver/annuler une dépense'),
('finance.indicateurs.read',     'finance', 'indicateurs',  'read',     'Consulter les indicateurs', 'Synthèse financière globale et par service'),
('finance.indicateurs.export',   'finance', 'indicateurs',  'export',   'Exporter la finance',      'Exporter les états financiers')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Attribution aux rôles
--    - pilotage global (DG, DGA, DIR_TECHNIQUE, AUDITEUR) : lecture + export
--    - comptable / trésorier : accès complet
--    - responsable pharmacie / PPV : accès limité au périmètre de leur point
-- -----------------------------------------------------------------------------
WITH attributions (role_code, motifs) AS (VALUES
  ('SUPER_ADMIN',   ARRAY['%']),
  ('DG',            ARRAY['finance.%.read', 'finance.indicateurs.export']),
  ('DGA',           ARRAY['finance.%.read', 'finance.indicateurs.export']),
  ('DIR_TECHNIQUE', ARRAY['finance.%.read', 'finance.indicateurs.export']),
  ('AUDITEUR',      ARRAY['finance.%.read']),
  ('COMPTABLE',     ARRAY['finance.%']),
  ('TRESORIER',     ARRAY['finance.%']),
  ('RESP_PHARMACIE',ARRAY['finance.services.read', 'finance.transactions.read',
                          'finance.transactions.create', 'finance.depenses.%',
                          'finance.indicateurs.read']),
  ('RESP_COMMERCIAL',ARRAY['finance.transactions.read', 'finance.indicateurs.read']),
  ('PPV',           ARRAY['finance.transactions.read', 'finance.depenses.read',
                          'finance.depenses.create', 'finance.indicateurs.read']),
  ('TECHNICIEN',    ARRAY['finance.transactions.read'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON EXISTS (
  SELECT 1 FROM unnest(a.motifs) AS m(motif) WHERE p.code LIKE m.motif
)
ON CONFLICT DO NOTHING;
