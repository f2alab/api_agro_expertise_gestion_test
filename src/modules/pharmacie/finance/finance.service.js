// Service financier de la pharmacie : chiffre d'affaires, marge, valeur du
// stock, encaissements, repartition par point et meilleurs produits.

import { query } from '../../../config/database.js';

/** Convertit les colonnes NUMERIC (renvoyees en texte par pg) en nombres. */
const nombre = (valeur) => Number(valeur ?? 0);

/** Indicateurs financiers consolides de la pharmacie. */
export async function indicateurs(filtres = {}) {
  const conditions = ["v.statut = 'VALIDEE'"];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`v.point_id = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`v.date_vente >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`v.date_vente < ($${parametres.length}::date + 1)`);
  }
  const clause = `WHERE ${conditions.join(' AND ')}`;
  const filtrePoint = filtres.pointId ? [filtres.pointId] : [];

  const [synthese, encaissement, valeur, parPoint, topProduits, serie] = await Promise.all([
    query(
      `SELECT count(*)::int AS nb_ventes,
              COALESCE(SUM(v.total_ht - COALESCE(r.montant_ht_retour, 0)), 0) AS total_ht,
              COALESCE(SUM(v.total_ttc - COALESCE(v.montant_retourne, 0)), 0) AS chiffre_affaires,
              COALESCE(SUM(v.cout_total - COALESCE(r.cout_retour, 0)), 0) AS cout_ventes,
              COALESCE(SUM(v.marge - (COALESCE(r.montant_ht_retour, 0) - COALESCE(r.cout_retour, 0))), 0) AS marge
       FROM pharmacie_ventes v
       LEFT JOIN (
         SELECT rv.vente_id,
                SUM(rl.total_ligne)                 AS montant_ht_retour,
                SUM(rl.cout_unitaire * rl.quantite) AS cout_retour
         FROM pharmacie_retours_ventes rv
         JOIN pharmacie_retours_ventes_lignes rl ON rl.retour_id = rv.id
         GROUP BY rv.vente_id
       ) r ON r.vente_id = v.id
       ${clause}`,
      parametres
    ),
    query(
      `SELECT COALESCE(SUM(p.montant), 0) AS encaisse
       FROM pharmacie_paiements p
       JOIN pharmacie_ventes v ON v.id = p.vente_id
       ${clause}`,
      parametres
    ),
    query('SELECT fn_pharmacie_valeur_stock($1) AS valeur', [filtres.pointId ?? null]),
    query(
      `SELECT point_id, point_code, point_nom, nb_ventes, chiffre_affaires, marge,
              valeur_stock_achat, encaisse
       FROM v_pharmacie_ca_par_point
       ${filtres.pointId ? 'WHERE point_id = $1' : ''}
       ORDER BY chiffre_affaires DESC`,
      filtrePoint
    ),
    query(
      `SELECT pr.nom_commercial,
              SUM(l.quantite)::int AS quantite,
              SUM(l.total_ligne)   AS chiffre_affaires,
              SUM(l.total_ligne - l.cout_unitaire * l.quantite) AS marge
       FROM pharmacie_ventes_lignes l
       JOIN pharmacie_ventes v ON v.id = l.vente_id
       JOIN pharmacie_produits pr ON pr.id = l.produit_id
       ${clause}
       GROUP BY pr.nom_commercial
       ORDER BY chiffre_affaires DESC
       LIMIT 8`,
      parametres
    ),
    query(
      `SELECT jour, SUM(chiffre_affaires) AS chiffre_affaires, SUM(marge) AS marge
       FROM v_pharmacie_ventes_journalieres
       ${filtres.pointId ? 'WHERE point_id = $1' : ''}
       GROUP BY jour
       ORDER BY jour DESC
       LIMIT 30`,
      filtrePoint
    ),
  ]);

  const s = synthese.rows[0];
  return {
    synthese: {
      nbVentes: s.nb_ventes,
      totalHT: nombre(s.total_ht),
      chiffreAffaires: nombre(s.chiffre_affaires),
      coutVentes: nombre(s.cout_ventes),
      marge: nombre(s.marge),
      encaisse: nombre(encaissement.rows[0].encaisse),
      valeurStock: nombre(valeur.rows[0].valeur),
    },
    parPoint: parPoint.rows.map((ligne) => ({
      pointId: ligne.point_id,
      pointCode: ligne.point_code,
      pointNom: ligne.point_nom,
      nbVentes: ligne.nb_ventes,
      chiffreAffaires: nombre(ligne.chiffre_affaires),
      marge: nombre(ligne.marge),
      valeurStock: nombre(ligne.valeur_stock_achat),
      encaisse: nombre(ligne.encaisse),
    })),
    topProduits: topProduits.rows.map((ligne) => ({
      nomCommercial: ligne.nom_commercial,
      quantite: ligne.quantite,
      chiffreAffaires: nombre(ligne.chiffre_affaires),
      marge: nombre(ligne.marge),
    })),
    serieJournaliere: serie.rows
      .map((ligne) => ({
        jour: ligne.jour,
        chiffreAffaires: nombre(ligne.chiffre_affaires),
        marge: nombre(ligne.marge),
      }))
      .reverse(),
  };
}