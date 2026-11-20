-- 43_validation_depenses_roles.sql
-- Validation des sorties d'argent : DG, DGA et Tresorier.
--
-- La permission `finance.depenses.validate` couvre la validation des depenses ET
-- des reglements de factures fournisseurs (commandes d'approvisionnement, y
-- compris le paiement saisi au moment de la commande). Elle est accordee a la
-- direction generale et a la tresorerie, en plus du comptable et du super
-- administrateur (deja couverts par `finance.%`).
--
-- Script rejouable (idempotent).

INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'finance.depenses.validate'
 WHERE r.code IN ('DG', 'DGA', 'TRESORIER')
ON CONFLICT DO NOTHING;