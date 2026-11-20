-- =============================================================================
-- GAE - ERP : 14_performance.sql
-- Index complémentaires pour la montée en charge (500 à 1000 utilisateurs).
--
-- Les index existants couvrent les clés étrangères et les tris principaux.
-- Ceux ajoutés ici couvrent les FILTRES combinés réellement utilisés par les
-- écrans et les tableaux de bord (statut + date, point + date, audit par module).
--
-- Script idempotent : CREATE INDEX IF NOT EXISTS.
-- A executer APRES 13_temps_reel.sql.
-- =============================================================================

SET client_encoding = 'UTF8';

-- Tableau de bord IAM : comptage des échecs récents par statut + date
CREATE INDEX IF NOT EXISTS idx_journal_audit_statut_date
  ON journal_audit(statut, cree_le DESC);

-- Filtres du journal d'audit par module
CREATE INDEX IF NOT EXISTS idx_journal_audit_module
  ON journal_audit(module);

-- Ventes : filtres « statut + période » (finance, tableaux de bord)
CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_statut_date
  ON pharmacie_ventes(statut, date_vente DESC);

-- Ventes : encaissements par période (indicateurs financiers)
CREATE INDEX IF NOT EXISTS idx_pharmacie_paiements_date
  ON pharmacie_paiements(date_paiement DESC);

-- Ventes : rapport « produits vendus » agrege par produit
CREATE INDEX IF NOT EXISTS idx_pharmacie_ventes_lignes_produit
  ON pharmacie_ventes_lignes(produit_id);

-- Mouvements de stock : derniers mouvements d'un point (ecran Stocks)
CREATE INDEX IF NOT EXISTS idx_pharmacie_mvt_point_date
  ON pharmacie_mouvements_stock(point_id, cree_le DESC);

-- Commandes : suivi par statut et date
CREATE INDEX IF NOT EXISTS idx_pharmacie_commandes_statut_date
  ON pharmacie_commandes(statut, date_commande DESC);

-- Inventaires : sessions en cours ou cloturees
CREATE INDEX IF NOT EXISTS idx_pharmacie_inventaires_statut_date
  ON pharmacie_inventaires(statut, date_debut DESC);

-- Sessions actives (tableau de bord) : index partiel sur les jetons vivants
CREATE INDEX IF NOT EXISTS idx_jetons_rafraichissement_actifs
  ON jetons_rafraichissement(expire_le)
  WHERE revoque_le IS NULL;

-- Statistiques des planificateurs mises a jour pour les nouveaux index
ANALYZE journal_audit;
ANALYZE pharmacie_ventes;
ANALYZE pharmacie_ventes_lignes;
ANALYZE pharmacie_paiements;
ANALYZE pharmacie_mouvements_stock;
ANALYZE pharmacie_commandes;
ANALYZE pharmacie_inventaires;
ANALYZE jetons_rafraichissement;
