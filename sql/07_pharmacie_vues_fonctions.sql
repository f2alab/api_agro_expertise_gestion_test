-- Module Pharmacie : vues et fonctions d'analyse.
-- A executer APRES 06_pharmacie_schema.sql.
--   v_pharmacie_stock              : quantite en stock par (point, produit)
--   v_pharmacie_stock_valorise     : stock + prix, seuil et valeur monetaire
--   v_pharmacie_alertes_stock      : produits sous le seuil ou proches peremption
--   v_pharmacie_ventes_journalieres: chiffre d'affaires et marge par jour
--   v_pharmacie_ca_par_point       : synthese financiere par point de vente
--   fn_pharmacie_valeur_stock      : valeur du stock d'un point (ou du reseau)

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Vue : quantite en stock par (point, produit)
-- Le stock est derive des mouvements : + entree/retour/transfert entrant,
-- - sortie/transfert sortant, et l'ajustement porte un delta signe.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_stock AS
SELECT
  m.point_id,
  m.produit_id,
  SUM(
    CASE m.type_mouvement
      WHEN 'ENTREE'            THEN m.quantite
      WHEN 'TRANSFERT_ENTREE'  THEN m.quantite
      WHEN 'RETOUR'            THEN m.quantite
      WHEN 'SORTIE'            THEN -m.quantite
      WHEN 'TRANSFERT_SORTIE'  THEN -m.quantite
      WHEN 'AJUSTEMENT'        THEN m.quantite
      ELSE 0
    END
  )::INTEGER AS quantite
FROM pharmacie_mouvements_stock m
GROUP BY m.point_id, m.produit_id;

COMMENT ON VIEW v_pharmacie_stock IS 'Quantite en stock par point de vente et produit.';

-- -----------------------------------------------------------------------------
-- Vue : stock valorise (quantite, prix d'achat, valeur monetaire, seuil)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_stock_valorise AS
SELECT
  pp.point_id,
  po.id            AS point_code_id,
  po.code          AS point_code,
  po.nom           AS point_nom,
  pr.id            AS produit_id,
  pr.code          AS produit_code,
  pr.nom_commercial,
  pr.categorie,
  COALESCE(s.quantite, 0)                          AS quantite,
  pp.prix_achat_reference                          AS prix_achat,
  pp.prix_vente                                    AS prix_vente,
  pp.seuil_alerte,
  ROUND(COALESCE(s.quantite, 0) * pp.prix_achat_reference, 2)  AS valeur_achat,
  ROUND(COALESCE(s.quantite, 0) * pp.prix_vente, 2)            AS valeur_vente
FROM pharmacie_produits_points pp
JOIN pharmacie_points   po ON po.id = pp.point_id
JOIN pharmacie_produits pr ON pr.id = pp.produit_id
LEFT JOIN v_pharmacie_stock s
  ON s.point_id = pp.point_id AND s.produit_id = pp.produit_id;

COMMENT ON VIEW v_pharmacie_stock_valorise IS 'Stock valorise (achat / vente) par point et produit.';

-- -----------------------------------------------------------------------------
-- Vue : alertes de stock (sous le seuil) et de peremption (proche ou depassee)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_alertes_stock AS
SELECT
  pp.point_id,
  po.nom AS point_nom,
  pp.produit_id,
  pr.nom_commercial,
  COALESCE(s.quantite, 0) AS quantite,
  pp.seuil_alerte,
  CASE
    WHEN COALESCE(s.quantite, 0) <= 0           THEN 'RUPTURE'
    WHEN COALESCE(s.quantite, 0) <= pp.seuil_alerte THEN 'SOUS_SEUIL'
    ELSE 'OK'
  END AS alerte_stock,
  (SELECT MIN(l.date_peremption)
     FROM pharmacie_lots l
    WHERE l.point_id = pp.point_id AND l.produit_id = pp.produit_id) AS prochaine_peremption
FROM pharmacie_produits_points pp
JOIN pharmacie_points   po ON po.id = pp.point_id
JOIN pharmacie_produits pr ON pr.id = pp.produit_id
LEFT JOIN v_pharmacie_stock s
  ON s.point_id = pp.point_id AND s.produit_id = pp.produit_id;

COMMENT ON VIEW v_pharmacie_alertes_stock IS 'Alertes : rupture, sous le seuil et prochaine peremption.';

-- -----------------------------------------------------------------------------
-- Vue : ventes journalieres (chiffre d'affaires et marge) par point
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_ventes_journalieres AS
SELECT
  v.point_id,
  po.nom                       AS point_nom,
  date_trunc('day', v.date_vente)::DATE AS jour,
  count(*)::INTEGER            AS nb_ventes,
  SUM(v.total_ttc)             AS chiffre_affaires,
  SUM(v.cout_total)            AS cout_total,
  SUM(v.marge)                 AS marge
FROM pharmacie_ventes v
JOIN pharmacie_points po ON po.id = v.point_id
WHERE v.statut = 'VALIDEE'
GROUP BY v.point_id, po.nom, date_trunc('day', v.date_vente)::DATE;

COMMENT ON VIEW v_pharmacie_ventes_journalieres IS 'Chiffre d''affaires et marge par jour et par point.';

-- -----------------------------------------------------------------------------
-- Vue : synthese financiere par point de vente
-- Chiffre d'affaires, marge, valeur du stock (achat), encaissements.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_ca_par_point AS
SELECT
  po.id   AS point_id,
  po.code AS point_code,
  po.nom  AS point_nom,
  COALESCE(v.nb_ventes, 0)          AS nb_ventes,
  COALESCE(v.chiffre_affaires, 0)   AS chiffre_affaires,
  COALESCE(v.marge, 0)              AS marge,
  COALESCE(v.cout_total, 0)         AS cout_ventes,
  COALESCE(st.valeur_stock, 0)      AS valeur_stock_achat,
  COALESCE(st.valeur_stock_vente, 0) AS valeur_stock_vente,
  COALESCE(pmt.encaisse, 0)         AS encaisse
FROM pharmacie_points po
LEFT JOIN (
  SELECT point_id,
         count(*)::INTEGER AS nb_ventes,
         SUM(total_ttc)    AS chiffre_affaires,
         SUM(marge)        AS marge,
         SUM(cout_total)   AS cout_total
  FROM pharmacie_ventes WHERE statut = 'VALIDEE' GROUP BY point_id
) v ON v.point_id = po.id
LEFT JOIN (
  SELECT point_id,
         SUM(valeur_achat) AS valeur_stock,
         SUM(valeur_vente) AS valeur_stock_vente
  FROM v_pharmacie_stock_valorise GROUP BY point_id
) st ON st.point_id = po.id
LEFT JOIN (
  SELECT v.point_id, SUM(p.montant) AS encaisse
  FROM pharmacie_paiements p
  JOIN pharmacie_ventes v ON v.id = p.vente_id
  WHERE v.statut = 'VALIDEE'
  GROUP BY v.point_id
) pmt ON pmt.point_id = po.id;

COMMENT ON VIEW v_pharmacie_ca_par_point IS 'Synthese financiere: CA, marge, valeur stock et encaissements par point.';

-- -----------------------------------------------------------------------------
-- Fonction : valeur du stock (prix d'achat) d'un point, ou de tout le reseau
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pharmacie_valeur_stock(p_point_id UUID DEFAULT NULL)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(valeur_achat), 0)
  FROM v_pharmacie_stock_valorise
  WHERE p_point_id IS NULL OR point_id = p_point_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_pharmacie_valeur_stock(UUID) IS 'Valeur du stock au prix d''achat (point donne ou reseau entier).';