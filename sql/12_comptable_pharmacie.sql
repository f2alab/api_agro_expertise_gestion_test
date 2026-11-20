-- Module Pharmacie : acces du Comptable (consultation de tout le module).
-- Le comptable voit tous les menus de la pharmacie mais en LECTURE SEULE :
-- il n'obtient aucune permission de creation / modification / suppression, et
-- pas de vente (pharmacie.ventes.create).
-- A executer APRES 11_pharmacie_ventes_restrictions.sql (idempotent).

SET client_encoding = 'UTF8';

INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.module = 'pharmacie' AND p.action = 'read'
WHERE r.code = 'COMPTABLE'
ON CONFLICT DO NOTHING;