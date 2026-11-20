-- =============================================================================
-- GAE - ERP : 32_lots_peremption.sql
-- Gestion par lot et suivi de la date de peremption des produits.
--   * `pharmacie_produits.gere_lot` / `gere_peremption` : fiche produit indiquant
--     si le produit est suivi par lot et/ou par date de peremption ;
--   * `v_pharmacie_lots_stock` : quantite restante par lot (derivee des
--     mouvements) et statut de peremption ;
--   * `v_pharmacie_alertes_stock` : ajout de l'alerte de peremption (lot perime
--     ou proche de la peremption) a cote des alertes de rupture / seuil ;
--   * parametre `pharmacie.peremption.jours_alerte` (fenetre d'alerte) ;
--   * index de recherche FEFO (premier perime, premier sorti).
-- A executer APRES 31_messages_saisonniers.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Fiche produit : suivi par lot et par peremption.
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_produits
  ADD COLUMN IF NOT EXISTS gere_lot        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gere_peremption BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN pharmacie_produits.gere_lot IS
  'Produit suivi par lot : chaque entree cree un lot et les sorties sont consommees en FEFO.';
COMMENT ON COLUMN pharmacie_produits.gere_peremption IS
  'Produit suivi par date de peremption : la date est obligatoire a l''entree et les lots sont alertes avant peremption.';

-- -----------------------------------------------------------------------------
-- 2. Parametre : fenetre d'alerte de peremption (jours), valeur par defaut 90.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('parametres') IS NOT NULL THEN
    INSERT INTO parametres (cle, valeur, categorie, libelle, description, type_valeur, public) VALUES
      ('pharmacie.peremption.jours_alerte', '90'::jsonb, 'pharmacie', 'Alerte de peremption (jours)',
       'Nombre de jours avant la date de peremption a partir duquel un lot est signale comme proche de la peremption.',
       'NOMBRE', TRUE)
    ON CONFLICT (cle) DO NOTHING;
  END IF;
END $$;

-- Fonction : fenetre d'alerte de peremption (lue dans `parametres`, defaut 90).
-- plpgsql + EXECUTE pour rester executable meme si `parametres` n'existe pas.
-- `#>> '{}'` extrait la valeur scalaire JSON sans guillemets (nombre ou chaine)
-- et un controle regex evite toute erreur de conversion dans les vues.
CREATE OR REPLACE FUNCTION fn_pharmacie_jours_alerte_peremption()
RETURNS INTEGER AS $$
DECLARE
  v_texte TEXT;
BEGIN
  IF to_regclass('parametres') IS NOT NULL THEN
    EXECUTE 'SELECT (valeur #>> ''{}'') FROM parametres WHERE cle = ''pharmacie.peremption.jours_alerte'''
      INTO v_texte;
  END IF;
  IF v_texte IS NOT NULL AND v_texte ~ '^[0-9]+$' THEN
    RETURN v_texte::int;
  END IF;
  RETURN 90;
END $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_pharmacie_jours_alerte_peremption() IS
  'Nombre de jours avant peremption declenchant une alerte (parametre, defaut 90).';

-- -----------------------------------------------------------------------------
-- 3. Index de recherche FEFO et de listing des lots.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pharmacie_lots_fefo
  ON pharmacie_lots(point_id, produit_id, date_peremption NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pharmacie_lots_numero
  ON pharmacie_lots(numero_lot);
-- -----------------------------------------------------------------------------
-- 4. Vue : quantite restante par lot et statut de peremption.
-- La quantite restante d'un lot = quantite d'entree du lot + mouvements lies
-- (sorties, ajustements, retours) : les mouvements ENTREE ne sont pas recomptes
-- puisqu'ils ont deja alimente `quantite_entree` a la creation du lot.
--   EPUISE            : plus aucune quantite
--   PERIME            : date de peremption depassee
--   PEREMPTION_PROCHE : peremption dans la fenetre d'alerte
--   OK                : lot valide
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_lots_stock AS
SELECT
  l.id                                        AS lot_id,
  l.point_id,
  po.nom                                      AS point_nom,
  l.produit_id,
  pr.code                                     AS produit_code,
  pr.nom_commercial,
  pr.gere_lot,
  pr.gere_peremption,
  l.numero_lot,
  l.date_peremption,
  l.prix_achat_unitaire,
  (l.date_peremption - CURRENT_DATE)::INTEGER AS jours_peremption,
  GREATEST(l.quantite_entree + COALESCE(m.delta, 0), 0) AS quantite_restante,
  CASE
    WHEN l.quantite_entree + COALESCE(m.delta, 0) <= 0 THEN 'EPUISE'
    WHEN l.date_peremption IS NOT NULL AND l.date_peremption < CURRENT_DATE THEN 'PERIME'
    WHEN l.date_peremption IS NOT NULL
         AND l.date_peremption <= CURRENT_DATE + fn_pharmacie_jours_alerte_peremption()
      THEN 'PEREMPTION_PROCHE'
    ELSE 'OK'
  END AS statut
FROM pharmacie_lots l
JOIN pharmacie_points   po ON po.id = l.point_id
JOIN pharmacie_produits pr ON pr.id = l.produit_id
LEFT JOIN (
  SELECT m.lot_id,
         SUM(
           CASE m.type_mouvement
             WHEN 'SORTIE'            THEN -m.quantite
             WHEN 'TRANSFERT_SORTIE'  THEN -m.quantite
             WHEN 'TRANSFERT_ENTREE'  THEN m.quantite
             WHEN 'RETOUR'            THEN m.quantite
             WHEN 'AJUSTEMENT'        THEN m.quantite
             ELSE 0
           END
         )::INTEGER AS delta
  FROM pharmacie_mouvements_stock m
  WHERE m.lot_id IS NOT NULL
  GROUP BY m.lot_id
) m ON m.lot_id = l.id;

COMMENT ON VIEW v_pharmacie_lots_stock IS
  'Lots avec quantite restante (derivee des mouvements) et statut de peremption.';

-- -----------------------------------------------------------------------------
-- 5. Vue : alertes de stock + alerte de peremption.
-- On recree la vue (colonnes ajoutées / reordonnees) : DROP necessaire car
-- CREATE OR REPLACE VIEW ne peut pas changer les noms de colonnes existants.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_pharmacie_alertes_stock;

CREATE VIEW v_pharmacie_alertes_stock AS
SELECT
  pp.point_id,
  po.nom                                                AS point_nom,
  pp.produit_id,
  pr.nom_commercial,
  COALESCE(s.quantite, 0)                               AS quantite,
  pp.seuil_alerte,
  CASE
    WHEN COALESCE(s.quantite, 0) <= 0                 THEN 'RUPTURE'
    WHEN COALESCE(s.quantite, 0) <= pp.seuil_alerte   THEN 'SOUS_SEUIL'
    ELSE 'OK'
  END                                                   AS alerte_stock,
  pr.gere_lot,
  pr.gere_peremption,
  l.prochaine_peremption,
  (l.prochaine_peremption - CURRENT_DATE)::INTEGER      AS jours_peremption,
  CASE
    WHEN l.prochaine_peremption IS NULL                                      THEN 'OK'
    WHEN l.prochaine_peremption < CURRENT_DATE                               THEN 'PERIME'
    WHEN l.prochaine_peremption <= CURRENT_DATE + fn_pharmacie_jours_alerte_peremption()
      THEN 'PEREMPTION_PROCHE'
    ELSE 'OK'
  END                                                   AS alerte_peremption
FROM pharmacie_produits_points pp
JOIN pharmacie_points   po ON po.id = pp.point_id
JOIN pharmacie_produits pr ON pr.id = pp.produit_id
LEFT JOIN v_pharmacie_stock s
  ON s.point_id = pp.point_id AND s.produit_id = pp.produit_id
LEFT JOIN (
  SELECT point_id, produit_id, MIN(date_peremption) AS prochaine_peremption
  FROM v_pharmacie_lots_stock
  WHERE quantite_restante > 0 AND date_peremption IS NOT NULL
  GROUP BY point_id, produit_id
) l ON l.point_id = pp.point_id AND l.produit_id = pp.produit_id;

COMMENT ON VIEW v_pharmacie_alertes_stock IS
  'Alertes : rupture, sous le seuil, prochaine peremption (lot restant le plus proche).';