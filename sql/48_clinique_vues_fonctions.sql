-- =============================================================================
-- GAE - ERP : 48_clinique_vues_fonctions.sql
-- Vues de lecture du module Clinique :
--   * v_clinique_dossier_animal        : dossier médical permanent d'un animal ;
--   * v_clinique_file_attente          : consultations en cours de prise en charge ;
--   * v_clinique_ordonnances_a_servir  : ordonnances envoyées à la pharmacie ;
--   * v_clinique_activite_journaliere  : activité et frais encaissés par jour.
-- A executer APRES 47_clinique_schema.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Dossier médical d'un animal : identité + propriétaire + statistiques de suivi.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_clinique_dossier_animal AS
SELECT a.id, a.code, a.nom, a.espece, a.race, a.sexe, a.statut,
       a.date_naissance, a.age_estime, a.poids_kg, a.robe, a.identification,
       a.signes_particuliers, a.created_at,
       p.id             AS proprietaire_id,
       p.code           AS proprietaire_code,
       p.nom            AS proprietaire_nom,
       p.telephone      AS proprietaire_telephone,
       p.type_proprietaire,
       (SELECT count(*)::int FROM clinique_consultations c WHERE c.animal_id = a.id)          AS nb_consultations,
       (SELECT max(c.accueil_le) FROM clinique_consultations c WHERE c.animal_id = a.id)      AS derniere_consultation,
       (SELECT count(*)::int FROM clinique_ordonnances o WHERE o.animal_id = a.id)            AS nb_ordonnances,
       (SELECT count(*)::int FROM clinique_examens_paracliniques e
         JOIN clinique_consultations c2 ON c2.id = e.consultation_id WHERE c2.animal_id = a.id) AS nb_examens_paracliniques
FROM clinique_animaux a
JOIN clinique_proprietaires p ON p.id = a.proprietaire_id;

COMMENT ON VIEW v_clinique_dossier_animal IS 'Dossier médical permanent d''un animal (identité, propriétaire, suivi).';

-- -----------------------------------------------------------------------------
-- File d'attente : toutes les consultations non clôturées, du plus ancien au
-- plus récent (l'écran d'accueil s'y appuie pour gérer les passages).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_clinique_file_attente AS
SELECT c.id, c.numero, c.statut, c.motif, c.type_consultation,
       c.frais_consultation, c.frais_payes, c.montant_frais_paye,
       c.accueil_le, c.consultation_debut, c.consultation_fin,
       a.id        AS animal_id,
       a.code      AS animal_code,
       a.nom       AS animal_nom,
       a.espece,
       p.nom       AS proprietaire_nom,
       p.telephone AS proprietaire_telephone,
       (u.nom || ' ' || u.prenom) AS accueil_par_nom
FROM clinique_consultations c
JOIN clinique_animaux a       ON a.id = c.animal_id
JOIN clinique_proprietaires p ON p.id = c.proprietaire_id
LEFT JOIN utilisateurs u      ON u.id = c.accueil_par
WHERE c.statut NOT IN ('CLOTURE', 'ANNULEE');

COMMENT ON VIEW v_clinique_file_attente IS 'Consultations en cours (accueil, consultation, paraclinique, ordonnance).';

-- -----------------------------------------------------------------------------
-- Ordonnances émises à destination de la pharmacie (non encore servies).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_clinique_ordonnances_a_servir AS
SELECT o.id, o.numero, o.statut, o.point_id, o.created_at AS emise_le,
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
WHERE o.statut = 'EMISE';

COMMENT ON VIEW v_clinique_ordonnances_a_servir IS 'Ordonnances transmises à la pharmacie et non encore servies.';

-- -----------------------------------------------------------------------------
-- Activité journalière : nombre de consultations, frais encaissés et attendus.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_clinique_activite_journaliere AS
SELECT c.accueil_le::date                                   AS jour,
       count(*)::int                                        AS nb_consultations,
       count(*) FILTER (WHERE c.frais_payes)::int           AS nb_payees,
       COALESCE(SUM(c.montant_frais_paye), 0)               AS total_frais,
       COALESCE(SUM(c.frais_consultation), 0)               AS total_frais_attendus
FROM clinique_consultations c
WHERE c.statut <> 'ANNULEE'
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW v_clinique_activite_journaliere IS 'Activité quotidienne de la clinique (consultations et frais).';
