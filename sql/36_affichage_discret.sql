-- =============================================================================
-- GAE - ERP : 36_affichage_discret.sql
-- Affichage discret des montants (protection de l'ecran contre les regards).
--   * parametres `affichage.discret.actif` / `affichage.discret.facteur` :
--     pilotent la reduction des montants AFFICHES cote frontend ;
--   * permission `parametres.affichage.update` : reservee a la Direction
--     Generale (seul le DG regle le facteur) ;
--   * aucune donnee en base n'est modifiee : les montants reels restent
--     intacts, seuls les indicateurs affiches a l'ecran sont reduits.
-- A executer APRES 35_pharmacie_rapports.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Parametres : autoriser la fonction et fixer le facteur de reduction.
--   * `public = TRUE` : tout profil authentifie doit connaitre le facteur pour
--     l'appliquer a l'affichage (les montants reels restent proteges par les
--     permissions metier : consulter un ecran ne donne pas acces aux chiffres
--     d'un autre perimetre) ;
--   * `0,075` correspond a l'exemple retenu : 200 F s'affichent 15 F.
-- -----------------------------------------------------------------------------
INSERT INTO parametres (cle, valeur, categorie, libelle, description, type_valeur, public) VALUES
  ('affichage.discret.actif', 'true'::jsonb, 'affichage', 'Affichage discret des montants',
   'Autoriser le masquage des montants a l''ecran (combinaison Ctrl + Alt + M). Les donnees enregistrees ne sont jamais modifiees : seuls les montants affiches sont reduits.',
   'BOOLEEN', TRUE),
  ('affichage.discret.facteur', '0.075'::jsonb, 'affichage', 'Facteur de reduction des montants',
   'Coefficient applique aux montants affiches lorsque l''affichage discret est actif : 0,075 affiche 15 F au lieu de 200 F. Valeur attendue entre 0,001 et 1.',
   'NOMBRE', TRUE)
ON CONFLICT (cle) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permission (module `parametres`) : reglage reserve a la Direction Generale.
-- Les profils qui peuvent modifier les parametres generaux (DGA, Directeur
-- Technique, Comptable) ne peuvent PAS modifier ces deux cles : le controle est
-- egalement applique cote API (voir parametres.controller.js).
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('parametres.affichage.update', 'parametres', 'affichage', 'update',
   'Gerer l''affichage discret', 'Regler le facteur de reduction des montants affiches a l''ecran')
ON CONFLICT (code) DO NOTHING;

-- Attribution : Direction Generale. SUPER_ADMIN est declare pour rester lisible
-- dans la matrice des droits (il contourne de toute facon les controles).
-- Pour autoriser aussi le Directeur General Adjoint, ajouter ('DGA') ci-dessous.
WITH attributions (role_code) AS (VALUES
  ('SUPER_ADMIN'),
  ('DG')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = 'parametres.affichage.update'
ON CONFLICT DO NOTHING;
