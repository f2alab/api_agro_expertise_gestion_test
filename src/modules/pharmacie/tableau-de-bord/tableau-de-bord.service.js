// Service du tableau de bord de la pharmacie : compteurs, finance du mois,
// alertes de stock et dernieres ventes.
//
// Le perimetre est applique : un compte rattache a une pharmacie (PPV...) ne
// voit QUE les donnees de sa pharmacie (ventes, encaissements, alertes, finance).

import { query } from '../../../config/database.js';
import { indicateurs } from '../finance/finance.service.js';

/** Renvoie une date au format AAAA-MM-JJ. */
const iso = (date) => date.toISOString().slice(0, 10);

/**
 * Indicateurs consolides affiches sur le dashboard de la pharmacie.
 * @param {string|null} pointId Pharmacie imposee (compte non global), sinon null
 *                              (vue de toutes les pharmacies).
 */
export async function tableauDeBordPharmacie(pointId = null) {
  const maintenant = new Date();
  const debutMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);

  const parametres = pointId ? [pointId] : [];
  const etPoint = pointId ? 'AND point_id = $1' : '';
  const etVentePoint = pointId ? 'AND v.point_id = $1' : '';

  const [compteurs, alertes, ventesRecentes] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*)::int FROM pharmacie_points WHERE actif ${pointId ? 'AND id = $1' : ''}) AS points_actifs,
         (SELECT count(*)::int FROM pharmacie_produits WHERE actif)                             AS produits_actifs,
         (SELECT count(*)::int FROM pharmacie_fournisseurs
           WHERE actif ${etPoint})                                                              AS fournisseurs_actifs,
         (SELECT count(*)::int FROM pharmacie_commandes
           WHERE statut IN ('BROUILLON','ENVOYEE','PARTIELLE') ${etPoint})                      AS commandes_en_cours,
         (SELECT count(*)::int FROM pharmacie_ventes
           WHERE statut = 'VALIDEE' AND date_vente::date = CURRENT_DATE ${etPoint})             AS ventes_jour,
         (SELECT COALESCE(SUM(total_ttc), 0) FROM pharmacie_ventes
           WHERE statut = 'VALIDEE' AND date_vente::date = CURRENT_DATE ${etPoint})             AS ca_jour,
         (SELECT count(*)::int FROM v_pharmacie_alertes_stock
           WHERE alerte_stock <> 'OK' ${etPoint})                                               AS alertes_stock,
         ${
           pointId
             ? `(SELECT count(DISTINCT v.client_id)::int FROM pharmacie_ventes v
                  WHERE v.client_id IS NOT NULL ${etVentePoint})`
             : `(SELECT count(*)::int FROM pharmacie_clients WHERE actif)`
         }                                                                                      AS clients_actifs`,
      parametres
    ),
    query(
      `SELECT point_nom, nom_commercial, quantite, seuil_alerte, alerte_stock
       FROM v_pharmacie_alertes_stock
       WHERE alerte_stock <> 'OK' ${etPoint}
       ORDER BY CASE alerte_stock WHEN 'RUPTURE' THEN 0 ELSE 1 END, quantite
       LIMIT 8`,
      parametres
    ),
    query(
      `SELECT v.id, v.numero, v.total_ttc, v.statut, v.date_vente, po.nom AS point_nom
       FROM pharmacie_ventes v
       JOIN pharmacie_points po ON po.id = v.point_id
       ${pointId ? 'WHERE v.point_id = $1' : ''}
       ORDER BY v.date_vente DESC
       LIMIT 6`,
      parametres
    ),
  ]);

  const finance = await indicateurs({
    du: iso(debutMois),
    au: iso(maintenant),
    pointId: pointId ?? undefined,
  });

  return {
    compteurs: {
      ...compteurs.rows[0],
      ca_jour: Number(compteurs.rows[0].ca_jour ?? 0),
    },
    finance,
    alertes: alertes.rows.map((ligne) => ({
      pointNom: ligne.point_nom,
      nomCommercial: ligne.nom_commercial,
      quantite: ligne.quantite,
      seuilAlerte: ligne.seuil_alerte,
      niveau: ligne.alerte_stock,
    })),
    ventesRecentes: ventesRecentes.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      totalTTC: Number(ligne.total_ttc),
      statut: ligne.statut,
      dateVente: ligne.date_vente,
      pointNom: ligne.point_nom,
    })),
  };
}