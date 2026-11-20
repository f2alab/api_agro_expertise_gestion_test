-- Module Pharmacie : restriction d'enregistrement des ventes.
-- Le technicien de pharmacie ne peut plus CREER de vente : il consulte les
-- ventes, mais l'ajout est reserve au PPV (et aux profils de gestion).
-- A executer APRES 10_pharmacie_clients.sql (idempotent).

SET client_encoding = 'UTF8';

DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'TECHNICIEN'
  AND p.code = 'pharmacie.ventes.create';