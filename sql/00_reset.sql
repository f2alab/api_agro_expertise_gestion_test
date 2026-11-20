-- =============================================================================
-- GAE - ERP : 00_reset.sql
-- Réinitialisation complète du schéma (usage : développement / tests uniquement)
-- ATTENTION : supprime TOUTES les données du module IAM.
-- Exécution : psql -U Geek -d gae_gestiondb -f sql/00_reset.sql
-- =============================================================================

DROP VIEW         IF EXISTS v_clinique_activite_journaliere        CASCADE;
DROP VIEW         IF EXISTS v_clinique_ordonnances_a_servir        CASCADE;
DROP VIEW         IF EXISTS v_clinique_file_attente                CASCADE;
DROP VIEW         IF EXISTS v_clinique_dossier_animal              CASCADE;

DROP TABLE        IF EXISTS clinique_factures_lignes               CASCADE;
DROP TABLE        IF EXISTS clinique_factures                      CASCADE;
DROP TABLE        IF EXISTS clinique_ordonnances_lignes            CASCADE;
DROP TABLE        IF EXISTS clinique_ordonnances                   CASCADE;
DROP TABLE        IF EXISTS clinique_examens_paracliniques         CASCADE;
DROP TABLE        IF EXISTS clinique_diagnostics                   CASCADE;
DROP TABLE        IF EXISTS clinique_examens_organes               CASCADE;
DROP TABLE        IF EXISTS clinique_examens                       CASCADE;
DROP TABLE        IF EXISTS clinique_consultations                 CASCADE;
DROP TABLE        IF EXISTS clinique_animaux                       CASCADE;
DROP TABLE        IF EXISTS clinique_proprietaires                 CASCADE;
DROP TABLE        IF EXISTS clinique_referentiels                  CASCADE;
DROP TABLE        IF EXISTS clinique_compteurs                     CASCADE;

DROP FUNCTION     IF EXISTS fn_clinique_numero(VARCHAR, INTEGER, SMALLINT) CASCADE;

DROP VIEW         IF EXISTS v_finance_echeances               CASCADE;
DROP VIEW         IF EXISTS v_finance_par_mode                CASCADE;
DROP VIEW         IF EXISTS v_finance_par_service             CASCADE;

DROP TABLE        IF EXISTS finance_echeances_rappels          CASCADE;
DROP TABLE        IF EXISTS finance_echeances                  CASCADE;
DROP TABLE        IF EXISTS finance_depenses                  CASCADE;
DROP TABLE        IF EXISTS finance_comptes                   CASCADE;
DROP TABLE        IF EXISTS finance_transactions              CASCADE;
DROP TABLE        IF EXISTS finance_services                 CASCADE;

DROP FUNCTION     IF EXISTS fn_finance_service_point(UUID)    CASCADE;
DROP FUNCTION     IF EXISTS fn_finance_service_point_trigger() CASCADE;

DROP VIEW         IF EXISTS v_pharmacie_stock                  CASCADE;
DROP VIEW         IF EXISTS v_pharmacie_stock_valorise         CASCADE;
DROP VIEW         IF EXISTS v_pharmacie_alertes_stock          CASCADE;
DROP VIEW         IF EXISTS v_pharmacie_ventes_journalieres    CASCADE;
DROP VIEW         IF EXISTS v_pharmacie_ca_par_point           CASCADE;

DROP TABLE        IF EXISTS pharmacie_retours_ventes_lignes   CASCADE;
DROP TABLE        IF EXISTS pharmacie_retours_ventes          CASCADE;
DROP TABLE        IF EXISTS pharmacie_paiements                CASCADE;
DROP TABLE        IF EXISTS pharmacie_ventes_lignes            CASCADE;
DROP TABLE        IF EXISTS pharmacie_ventes                   CASCADE;
DROP FUNCTION     IF EXISTS fn_pharmacie_vente_maj_paiements() CASCADE;
DROP TABLE        IF EXISTS pharmacie_clients                  CASCADE;
DROP TABLE        IF EXISTS pharmacie_caisses                  CASCADE;
DROP TABLE        IF EXISTS pharmacie_inventaires_lignes       CASCADE;
DROP TABLE        IF EXISTS pharmacie_inventaires              CASCADE;
DROP TABLE        IF EXISTS pharmacie_reglements                  CASCADE;
DROP TABLE        IF EXISTS pharmacie_demandes_ravitaillement_lignes CASCADE;
DROP TABLE        IF EXISTS pharmacie_demandes_ravitaillement        CASCADE;
-- Anciennes tables d'un essai abandonne (noms historiques) : nettoyees pour
-- qu'une reinitialisation reparte d'un schema coherent.
DROP TABLE        IF EXISTS pharmacie_ravitaillements_lignes         CASCADE;
DROP TABLE        IF EXISTS pharmacie_ravitaillements                 CASCADE;
DROP TABLE        IF EXISTS pharmacie_receptions               CASCADE;
DROP TABLE        IF EXISTS pharmacie_commandes_lignes         CASCADE;
DROP TABLE        IF EXISTS pharmacie_commandes                CASCADE;
DROP TABLE        IF EXISTS pharmacie_fournisseurs             CASCADE;
DROP TABLE        IF EXISTS pharmacie_mouvements_stock         CASCADE;
DROP TABLE        IF EXISTS pharmacie_lots                     CASCADE;
DROP TABLE        IF EXISTS pharmacie_produits_points          CASCADE;
DROP TABLE        IF EXISTS pharmacie_referentiels             CASCADE;
DROP TABLE        IF EXISTS pharmacie_produits                 CASCADE;
DROP TABLE        IF EXISTS pharmacie_points                   CASCADE;

DROP FUNCTION     IF EXISTS fn_pharmacie_valeur_stock(UUID)    CASCADE;

DROP VIEW         IF EXISTS v_utilisateurs_effectifs          CASCADE;
DROP VIEW         IF EXISTS v_permissions_effectives          CASCADE;

DROP TABLE        IF EXISTS journal_audit                     CASCADE;
DROP TABLE        IF EXISTS jetons_reinitialisation            CASCADE;
DROP TABLE        IF EXISTS jetons_rafraichissement            CASCADE;
DROP TABLE        IF EXISTS utilisateurs_photos                 CASCADE;
DROP TABLE        IF EXISTS utilisateurs_departements          CASCADE;
DROP TABLE        IF EXISTS utilisateurs_roles                 CASCADE;
DROP TABLE        IF EXISTS roles_permissions                  CASCADE;
DROP TABLE        IF EXISTS parametres                         CASCADE;
DROP TABLE        IF EXISTS utilisateurs                       CASCADE;
DROP TABLE        IF EXISTS roles                              CASCADE;
DROP TABLE        IF EXISTS permissions                        CASCADE;
DROP TABLE        IF EXISTS departements                       CASCADE;

DROP FUNCTION     IF EXISTS fn_maj_horodatage()                CASCADE;
DROP FUNCTION     IF EXISTS fn_permissions_utilisateur(UUID)   CASCADE;
DROP FUNCTION     IF EXISTS fn_est_super_admin(UUID)           CASCADE;
DROP FUNCTION     IF EXISTS fn_arbre_departements()            CASCADE;
