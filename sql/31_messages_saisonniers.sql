-- =============================================================================
-- GAE - ERP : 31_messages_saisonniers.sql
-- Messages saisonniers imprimes en bas des recus de vente (A4, 80 mm, ESC/POS).
--   * `pharmacie.recu.entete.actif`    : afficher ou non ces messages (defaut OUI) ;
--   * `pharmacie.recu.entete.messages` : messages et leurs periodes d'affichage.
--
-- Les deux reglages sont PUBLICS : les ecrans metier (page des ventes) les lisent
-- via `GET /parametres/publics`, sans permission particuliere. Ils se modifient
-- depuis la page `/parametres` (Direction / Directeur Technique / Comptable) ou
-- via `PUT /parametres/:cle`.
--
-- Format d'une entree de `pharmacie.recu.entete.messages` :
--   { "debut": "MM-JJ", "fin": "MM-JJ", "message": "texte" }
--   * `debut` / `fin` : bornes incluses, au format mois-jour ; la periode peut
--     chevaucher deux annees (ex. 12-28 -> 01-14) ;
--   * `message` : texte imprime ; le jeton `{annee}` est remplace par l'annee a
--     souhaiter (l'annee suivante si le recu est imprime en decembre).
-- En cas de periodes qui se chevauchent, la premiere entree de la liste gagne.
--
-- A executer APRES 30_suppression_client_denormalise.sql (script idempotent).
--   npm run db:migrate -- 31_messages_saisonniers.sql
-- =============================================================================

SET client_encoding = 'UTF8';

INSERT INTO parametres (cle, valeur, categorie, libelle, description, type_valeur, public) VALUES
  ('pharmacie.recu.entete.actif', 'true'::jsonb, 'pharmacie', 'Messages de fin d''annee sur les recus',
   'Afficher un message saisonnier (fetes de fin d''annee, nouvel an) en bas des recus de vente.',
   'BOOLEEN', TRUE),
  ('pharmacie.recu.entete.messages',
   -- Chaines Unicode (U&'...') : le fichier reste en ASCII pur, les accents sont
   -- produits exactement par PostgreSQL quelle que soit l'encodage du fichier.
   U&'[
      { "debut": "12-22", "fin": "12-25", "message": "Joyeux No\00EBl" },
      { "debut": "12-28", "fin": "01-14", "message": "BONNE ET HEUREUSE ANN\00C9E {annee}" }
    ]'::jsonb,
   'pharmacie', 'Messages saisonniers des recus',
   'Liste des messages affiches en bas des recus. Chaque entree : "debut" et "fin" au format MM-JJ (periode pouvant chevaucher deux annees) et "message" ({annee} = annee a souhaiter).',
   'JSON', TRUE)
ON CONFLICT (cle) DO NOTHING;
