-- =============================================================================
-- GAE - ERP : 56_ordonnances_validation.sql
-- Module Clinique : l'ordonnance du vétérinaire consultant est une PROPOSITION
-- que le Docteur vétérinaire approuve avant transmission a la pharmacie.
--
-- Statuts utilises (contrainte deja en place sur clinique_ordonnances) :
--   BROUILLON : proposition en attente d'approbation (invisible en pharmacie) ;
--   EMISE     : approuvee, la pharmacie peut la servir ;
--   SERVIE    : produits delivres ;  ANNULEE : proposition rejetee.
--
-- Trois consequences :
--   1. la trace de l'approbation est conservee (`approuve_par`, `approuve_le`) ;
--   2. separation des taches : le role TECHNICIEN (consultant) perd la
--      permission `clinique.ordonnances.validate` ;
--   3. nouvelle permission `clinique.ordonnances.approve`, detenue par la
--      Direction Technique et le Responsable clinique (Docteur veterinaire).
-- A executer APRES 55_temps_reel_clinique.sql (idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- Trace de l'approbation.
ALTER TABLE clinique_ordonnances ADD COLUMN IF NOT EXISTS approuve_par UUID;
ALTER TABLE clinique_ordonnances ADD COLUMN IF NOT EXISTS approuve_le  TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_clinique_ordonnances_approuve_par') THEN
    ALTER TABLE clinique_ordonnances
      ADD CONSTRAINT fk_clinique_ordonnances_approuve_par
      FOREIGN KEY (approuve_par) REFERENCES utilisateurs(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN clinique_ordonnances.approuve_par
  IS 'Docteur veterinaire qui a approuve la proposition d''ordonnance.';
COMMENT ON COLUMN clinique_ordonnances.approuve_le
  IS 'Date d''approbation : l''ordonnance est transmise a la pharmacie a partir de ce moment.';

-- Separation des tâches :
--   * le consultant (TECHNICIEN) propose une ordonnance, il ne l'approuve pas
--     et ne peut pas la marquer servie ;
--   * le Docteur veterinaire (Direction Technique, Responsable clinique) approuve
--     la proposition : c'est l'acte medical ;
--   * la pharmacie (Responsable pharmacie) sert l'ordonnance approuvee.
--
-- L'action `approve` est ajoutee au catalogue des actions autorisees : elle est
-- distincte de `validate` (marquer servie), afin qu'un detenteur du droit de
-- service en pharmacie ne puisse pas engager une prescription.
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS ck_permissions_action;
ALTER TABLE permissions
  ADD CONSTRAINT ck_permissions_action CHECK (
    action IN ('read','create','update','delete','assign','validate','approve','export','manage')
  );

INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('clinique.ordonnances.approve', 'clinique', 'ordonnances', 'approve',
   'Approuver une ordonnance',
   'Valider la proposition du vétérinaire consultant avant transmission à la pharmacie')
ON CONFLICT (code) DO NOTHING;

-- Libelles precisés : `validate` ne couvre plus que le service en pharmacie.
UPDATE permissions
   SET nom = 'Servir une ordonnance en pharmacie',
       description = 'Delivrer une ordonnance approuvee et la marquer servie'
 WHERE code = 'clinique.ordonnances.validate';

UPDATE permissions
   SET nom = 'Modifier une proposition d ordonnance',
       description = 'Ajuster une proposition en attente d approbation'
 WHERE code = 'clinique.ordonnances.update';

-- Retrait du droit de service aupres du consultant (il propose seulement).
DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'TECHNICIEN'
  AND p.code IN ('clinique.ordonnances.validate', 'clinique.ordonnances.approve');

-- Attribution : l'approbation revient aux medecins, le service a la pharmacie.
WITH attributions (role_code, codes) AS (VALUES
  ('DIR_TECHNIQUE',    ARRAY['clinique.ordonnances.approve', 'clinique.ordonnances.validate',
                             'clinique.ordonnances.update']),
  ('RESP_CLINIQUE',    ARRAY['clinique.ordonnances.approve', 'clinique.ordonnances.validate',
                             'clinique.ordonnances.update']),
  ('RESP_PHARMACIE',   ARRAY['clinique.ordonnances.validate']),
  ('DG',               ARRAY['clinique.ordonnances.approve']),
  ('DGA',              ARRAY['clinique.ordonnances.approve'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = ANY(a.codes)
ON CONFLICT DO NOTHING;

-- Le super administrateur detient le catalogue complet.
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'clinique.ordonnances.approve'
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- La file de la pharmacie expose aussi le prescripteur et l'approbateur
-- (affiches dans l'acte d'approbation et sur le document imprime). La vue est
-- recreee (CREATE OR REPLACE ne suffit pas : les colonnes sont inserees avant
-- les colonnes existantes).
DROP VIEW IF EXISTS v_clinique_ordonnances_a_servir;
CREATE VIEW v_clinique_ordonnances_a_servir AS
SELECT o.id, o.numero, o.statut, o.point_id, o.created_at AS emise_le,
       o.approuve_le,
       (em.nom || ' ' || em.prenom) AS emis_par_nom,
       (ap.nom || ' ' || ap.prenom) AS approuve_par_nom,
       a.code AS animal_code, a.nom AS animal_nom, a.espece,
       p.nom AS proprietaire_nom, p.telephone AS proprietaire_telephone,
       po.nom AS point_nom,
       (SELECT count(*)::int FROM clinique_ordonnances_lignes l WHERE l.ordonnance_id = o.id) AS nb_lignes,
       (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0)
          FROM clinique_ordonnances_lignes l WHERE l.ordonnance_id = o.id) AS montant_estime
FROM clinique_ordonnances o
JOIN clinique_animaux a       ON a.id = o.animal_id
JOIN clinique_proprietaires p ON p.id = o.proprietaire_id
LEFT JOIN pharmacie_points po ON po.id = o.point_id
LEFT JOIN utilisateurs em     ON em.id = o.emis_par
LEFT JOIN utilisateurs ap     ON ap.id = o.approuve_par
-- Seules les ordonnances APPROUVEES entrent dans la file : une proposition
-- (BROUILLON) n'est jamais servie ni vendue en pharmacie.
WHERE o.statut = 'EMISE';

-- Controle rapide (decommenter au besoin) :
-- SELECT r.code FROM roles r
-- JOIN roles_permissions rp ON rp.role_id = r.id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code = 'clinique.ordonnances.validate' ORDER BY r.code;