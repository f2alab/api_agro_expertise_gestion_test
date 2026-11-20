// Service des stocks de la pharmacie : catalogue vendable, mouvements
// entree/sortie, valorisation et alertes. Le stock est derive des mouvements.

import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';

// Signe applique a la quantite selon le type de mouvement
const SENS = {
  ENTREE: 1,
  TRANSFERT_ENTREE: 1,
  RETOUR: 1,
  SORTIE: -1,
  TRANSFERT_SORTIE: -1,
  AJUSTEMENT: 1,
};

/** Transforme une ligne de mouvement en objet API. */
function serialiserMouvement(ligne) {
  return {
    id: ligne.id,
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    produitNom: ligne.produit_nom,
    lotId: ligne.lot_id,
    numeroLot: ligne.numero_lot ?? null,
    datePeremption: ligne.date_peremption ?? null,
    typeMouvement: ligne.type_mouvement,
    quantite: ligne.quantite,
    prixUnitaire: Number(ligne.prix_unitaire),
    valeur: Number(ligne.prix_unitaire) * ligne.quantite,
    motif: ligne.motif ?? null,
    referenceType: ligne.reference_type ?? null,
    referenceId: ligne.reference_id ?? null,
    utilisateur: ligne.utilisateur_nom
      ? { id: ligne.utilisateur_id, nomComplet: ligne.utilisateur_nom }
      : null,
    creeLe: ligne.cree_le,
  };
}

/** Catalogue vendable d'un point : produits parametres, prix et quantite. */
export async function listerCatalogue(pointId, recherche) {
  const parametres = [pointId];
  let filtre = '';
  if (recherche) {
    parametres.push(`%${recherche}%`);
    filtre = 'AND (pr.nom_commercial ILIKE $2 OR pr.code ILIKE $2 OR pr.dci ILIKE $2)';
  }

  const { rows } = await query(
    `SELECT pr.id, pr.code, pr.dci, pr.nom_commercial, pr.categorie, pr.unite_mesure,
            pr.necessite_ordonnance, pr.gere_lot, pr.gere_peremption, pr.tva_taux,
            pp.prix_vente, pp.prix_achat_reference, pp.seuil_alerte,
            pp.disponible, COALESCE(s.quantite, 0) AS quantite
     FROM pharmacie_produits_points pp
     JOIN pharmacie_produits pr ON pr.id = pp.produit_id AND pr.actif = TRUE
     LEFT JOIN v_pharmacie_stock s
       ON s.point_id = pp.point_id AND s.produit_id = pp.produit_id
     WHERE pp.point_id = $1 AND pp.disponible = TRUE ${filtre}
     ORDER BY pr.nom_commercial`,
    parametres
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    code: ligne.code,
    dci: ligne.dci,
    nomCommercial: ligne.nom_commercial,
    categorie: ligne.categorie,
    uniteMesure: ligne.unite_mesure,
    necessiteOrdonnance: Boolean(ligne.necessite_ordonnance),
    // Produit suivi par lot / par date de peremption (saisie obligatoire).
    gereLot: Boolean(ligne.gere_lot),
    gerePeremption: Boolean(ligne.gere_peremption),
    // Taux de TVA du produit (0 si non assujetti) : indispensable pour afficher
    // le total TTC au comptoir, identique a celui calcule par le serveur.
    tvaTaux: Number(ligne.tva_taux ?? 0),
    prixVente: Number(ligne.prix_vente),
    prixAchatReference: Number(ligne.prix_achat_reference),
    seuilAlerte: ligne.seuil_alerte,
    disponible: Boolean(ligne.disponible),
    quantite: ligne.quantite,
  }));
}

// -----------------------------------------------------------------------------
// Mouvements de stock
// -----------------------------------------------------------------------------

/** Recupere un mouvement detaille. */
async function obtenirMouvement(id) {
  const { rows } = await query(
    `SELECT m.*, po.nom AS point_nom, pr.code AS produit_code, pr.nom_commercial AS produit_nom,
            l.numero_lot, l.date_peremption,
            (u.nom || ' ' || u.prenom) AS utilisateur_nom
     FROM pharmacie_mouvements_stock m
     JOIN pharmacie_points po ON po.id = m.point_id
     JOIN pharmacie_produits pr ON pr.id = m.produit_id
     LEFT JOIN pharmacie_lots l ON l.id = m.lot_id
     LEFT JOIN utilisateurs u ON u.id = m.utilisateur_id
     WHERE m.id = $1`,
    [id]
  );
  return rows[0] ? serialiserMouvement(rows[0]) : null;
}

/** Quantite en stock d'un produit dans un point. */
async function quantiteStock(client, pointId, produitId) {
  const { rows } = await client.query(
    'SELECT COALESCE(quantite, 0) AS quantite FROM v_pharmacie_stock WHERE point_id = $1 AND produit_id = $2',
    [pointId, produitId]
  );
  return rows[0]?.quantite ?? 0;
}

/**
 * Normalise une date en 'AAAA-MM-JJ' (colonne DATE). Evite tout decalage de
 * fuseau horaire lorsqu'une Date JavaScript est transmise au pilote.
 */
function dateSql(valeur) {
  if (!valeur) return null;
  if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
  return String(valeur).slice(0, 10);
}

/** Insere un mouvement de stock et renvoie son identifiant. */
async function insererMouvement(client, donnees, acteur = null) {
  const { rows } = await client.query(
    `INSERT INTO pharmacie_mouvements_stock
       (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
        reference_type, reference_id, utilisateur_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      donnees.pointId,
      donnees.produitId,
      donnees.lotId ?? null,
      donnees.typeMouvement,
      donnees.quantite,
      donnees.prixUnitaire ?? 0,
      donnees.motif ?? null,
      donnees.referenceType ?? null,
      donnees.referenceId ?? null,
      acteur?.id ?? null,
    ]
  );
  return rows[0].id;
}

/**
 * Consomme une quantite en suivant le FEFO (First Expired, First Out) : les lots
 * dont la peremption est la plus proche sont servis en premier. Chaque lot
 * consomme genere un mouvement de sortie rattache a ce lot ; le reliquat
 * eventuel (stock non suivi par lot) est sorti sans lot.
 */
export async function consommerLotsFEFO(client, donnees, acteur = null) {
  const { rows: lots } = await client.query(
    `SELECT lot_id, quantite_restante
       FROM v_pharmacie_lots_stock
      WHERE point_id = $1 AND produit_id = $2 AND quantite_restante > 0
      ORDER BY date_peremption ASC NULLS LAST, lot_id`,
    [donnees.pointId, donnees.produitId]
  );

  let restant = donnees.quantite;
  const ids = [];
  for (const lot of lots) {
    if (restant <= 0) break;
    const pris = Math.min(restant, lot.quantite_restante);
    if (pris <= 0) continue;
    ids.push(
      await insererMouvement(client, { ...donnees, lotId: lot.lot_id, quantite: pris }, acteur)
    );
    restant -= pris;
  }
  if (restant > 0) {
    ids.push(await insererMouvement(client, { ...donnees, lotId: null, quantite: restant }, acteur));
  }
  return ids;
}

/**
 * Enregistre un mouvement de stock.
 * Entree : un lot est cree (ou reutilise) a partir du numero et de la date de
 * peremption ; la date est obligatoire pour un produit qui la suit.
 * Sortie : le stock disponible est verifie ; un produit gere par lot est
 * consomme en FEFO (un mouvement par lot).
 */
export async function enregistrerMouvement(donnees, acteur = null) {
  const ids = await transaction(async (client) => {
    const { rows: parametres } = await client.query(
      `SELECT pr.gere_lot, pr.gere_peremption
         FROM pharmacie_produits_points pp
         JOIN pharmacie_produits pr ON pr.id = pp.produit_id
        WHERE pp.produit_id = $1 AND pp.point_id = $2`,
      [donnees.produitId, donnees.pointId]
    );
    if (parametres.length === 0) {
      throw ApiError.conflict(
        "Ce produit n'est pas parametre pour ce point de vente.",
        'PRODUIT_NON_PARAMETRE'
      );
    }
    const gereLot = Boolean(parametres[0].gere_lot);
    const gerePeremption = Boolean(parametres[0].gere_peremption);
    const estSortie = (SENS[donnees.typeMouvement] ?? 1) < 0;
    const mouvement = {
      pointId: donnees.pointId,
      produitId: donnees.produitId,
      typeMouvement: donnees.typeMouvement,
      prixUnitaire: donnees.prixUnitaire ?? 0,
      motif: donnees.motif ?? null,
      referenceType: donnees.referenceType ?? null,
      referenceId: donnees.referenceId ?? null,
    };

    if (estSortie) {
      const disponible = await quantiteStock(client, donnees.pointId, donnees.produitId);
      if (disponible < donnees.quantite) {
        throw ApiError.conflict(
          `Stock insuffisant (disponible : ${disponible}).`,
          'STOCK_INSUFFISANT',
          { disponible, demande: donnees.quantite }
        );
      }
      // Produit gere par lot : consommation FEFO (un mouvement de sortie par lot).
      if (gereLot) {
        return consommerLotsFEFO(client, { ...mouvement, quantite: donnees.quantite }, acteur);
      }
      return [
        await insererMouvement(
          client,
          { ...mouvement, quantite: donnees.quantite, lotId: donnees.lotId ?? null },
          acteur
        ),
      ];
    }

    // Entree : la date de peremption est obligatoire si le produit la suit.
    if (donnees.typeMouvement === 'ENTREE' && gerePeremption && !donnees.datePeremption) {
      throw ApiError.badRequest(
        'La date de peremption est obligatoire pour ce produit.',
        'PEREMPTION_REQUISE',
        { produitId: donnees.produitId }
      );
    }

    let lotId = donnees.lotId ?? null;
    if (!lotId && (donnees.numeroLot || donnees.datePeremption)) {
      // Reutilise le lot identique (meme numero + meme peremption) pour eviter
      // les doublons a chaque entree ; sinon creation d'un nouveau lot.
      const existant = await client.query(
        `SELECT id FROM pharmacie_lots
          WHERE point_id = $1 AND produit_id = $2
            AND numero_lot IS NOT DISTINCT FROM $3
            AND date_peremption IS NOT DISTINCT FROM $4
          LIMIT 1`,
        [
          donnees.pointId,
          donnees.produitId,
          donnees.numeroLot ?? null,
          dateSql(donnees.datePeremption),
        ]
      );
      if (existant.rows[0]) {
        lotId = existant.rows[0].id;
        await client.query(
          'UPDATE pharmacie_lots SET quantite_entree = quantite_entree + $1 WHERE id = $2',
          [donnees.quantite, lotId]
        );
      } else {
        const lot = await client.query(
          `INSERT INTO pharmacie_lots
             (point_id, produit_id, numero_lot, date_peremption, prix_achat_unitaire, quantite_entree)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            donnees.pointId,
            donnees.produitId,
            donnees.numeroLot ?? null,
            dateSql(donnees.datePeremption),
            donnees.prixUnitaire ?? 0,
            donnees.quantite,
          ]
        );
        lotId = lot.rows[0].id;
      }
    }

    return [
      await insererMouvement(client, { ...mouvement, quantite: donnees.quantite, lotId }, acteur),
    ];
  });

  return obtenirMouvement(ids[0]);
}

/** Liste paginee des mouvements, avec filtres. */
export async function listerMouvements(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`m.point_id = $${parametres.length}`);
  }
  if (filtres.produitId) {
    parametres.push(filtres.produitId);
    conditions.push(`m.produit_id = $${parametres.length}`);
  }
  if (filtres.typeMouvement) {
    parametres.push(filtres.typeMouvement);
    conditions.push(`m.type_mouvement = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`m.cree_le >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`m.cree_le < ($${parametres.length}::date + 1)`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM pharmacie_mouvements_stock m ${clause}`, parametres),
    query(
      `SELECT m.*, po.nom AS point_nom, pr.code AS produit_code, pr.nom_commercial AS produit_nom,
              l.numero_lot, l.date_peremption,
              (u.nom || ' ' || u.prenom) AS utilisateur_nom
       FROM pharmacie_mouvements_stock m
       JOIN pharmacie_points po ON po.id = m.point_id
       JOIN pharmacie_produits pr ON pr.id = m.produit_id
       LEFT JOIN pharmacie_lots l ON l.id = m.lot_id
       LEFT JOIN utilisateurs u ON u.id = m.utilisateur_id
       ${clause}
       ORDER BY m.cree_le DESC, m.id DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserMouvement), compteur.rows[0].total, { page, limite });
}

// -----------------------------------------------------------------------------
// Valorisation et alertes
// -----------------------------------------------------------------------------

/** Stock valorise par produit et par point (pagine). */
export async function listerStockValorise(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`point_id = $${parametres.length}`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    conditions.push(
      `(nom_commercial ILIKE $${parametres.length} OR produit_code ILIKE $${parametres.length})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Totaux du filtre complet, independants de la page affichee : nombre de
  // lignes, produits reellement en stock (quantite > 0), quantite et
  // valorisation aux prix d'achat et de vente. Une seule requete d'agregation
  // remplace le compteur (COUNT) precedent.
  const totaux = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE quantite > 0)::int AS produits_disponibles,
            COALESCE(SUM(quantite), 0)::int AS quantite,
            COALESCE(SUM(valeur_achat), 0) AS valeur_achat,
            COALESCE(SUM(valeur_vente), 0) AS valeur_vente
       FROM v_pharmacie_stock_valorise ${clause}`,
    parametres
  );

  const { rows } = await query(
    `SELECT point_id, point_code, point_nom, produit_id, produit_code, nom_commercial, categorie,
            quantite, prix_achat, prix_vente, seuil_alerte, valeur_achat, valeur_vente
     FROM v_pharmacie_stock_valorise ${clause}
     ORDER BY point_nom, nom_commercial
     LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
    [...parametres, limite, offset]
  );

  const donnees = rows.map((ligne) => ({
    pointId: ligne.point_id,
    pointCode: ligne.point_code,
    pointNom: ligne.point_nom,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    nomCommercial: ligne.nom_commercial,
    categorie: ligne.categorie,
    quantite: ligne.quantite,
    prixAchat: Number(ligne.prix_achat),
    prixVente: Number(ligne.prix_vente),
    seuilAlerte: ligne.seuil_alerte,
    valeurAchat: Number(ligne.valeur_achat),
    valeurVente: Number(ligne.valeur_vente),
  }));

  return {
    ...reponsePaginee(donnees, totaux.rows[0].total, { page, limite }),
    // Valorisation globale du filtre (toutes les pages), affichee en indicateurs.
    totaux: {
      // Produits reellement en stock : quantite strictement positive.
      produitsDisponibles: Number(totaux.rows[0].produits_disponibles),
      quantite: Number(totaux.rows[0].quantite),
      valeurAchat: Number(totaux.rows[0].valeur_achat),
      valeurVente: Number(totaux.rows[0].valeur_vente),
    },
  };
}

/** Lots d'un point (ou du reseau) : quantite restante et statut de peremption. */
export async function listerLots(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`point_id = $${parametres.length}`);
  }
  if (filtres.produitId) {
    parametres.push(filtres.produitId);
    conditions.push(`produit_id = $${parametres.length}`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`statut = $${parametres.length}`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(nom_commercial ILIKE $${i} OR produit_code ILIKE $${i} OR numero_lot ILIKE $${i})`);
  }
  if (filtres.peremptionAvant) {
    parametres.push(filtres.peremptionAvant);
    conditions.push(`date_peremption IS NOT NULL AND date_peremption <= $${parametres.length}::date`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const compteur = await query(
    `SELECT COUNT(*)::int AS total FROM v_pharmacie_lots_stock ${clause}`,
    parametres
  );

  const { rows } = await query(
    `SELECT lot_id, point_id, point_nom, produit_id, produit_code, nom_commercial,
            gere_lot, gere_peremption, numero_lot, date_peremption, prix_achat_unitaire,
            jours_peremption, quantite_restante, statut
     FROM v_pharmacie_lots_stock
     ${clause}
     ORDER BY CASE statut
                WHEN 'PERIME' THEN 0
                WHEN 'PEREMPTION_PROCHE' THEN 1
                WHEN 'OK' THEN 2
                ELSE 3
              END,
              date_peremption NULLS LAST, nom_commercial
     LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
    [...parametres, limite, offset]
  );

  const donnees = rows.map((ligne) => ({
    id: ligne.lot_id,
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    nomCommercial: ligne.nom_commercial,
    gereLot: Boolean(ligne.gere_lot),
    gerePeremption: Boolean(ligne.gere_peremption),
    numeroLot: ligne.numero_lot ?? null,
    datePeremption: ligne.date_peremption,
    prixAchatUnitaire: Number(ligne.prix_achat_unitaire),
    joursPeremption: ligne.jours_peremption,
    quantiteRestante: ligne.quantite_restante,
    statut: ligne.statut,
  }));

  return reponsePaginee(donnees, compteur.rows[0].total, { page, limite });
}

/** Alertes : rupture / sous le seuil et lot perime / proche de la peremption. */
export async function listerAlertes(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = ["(alerte_stock <> 'OK' OR alerte_peremption <> 'OK')"];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`point_id = $${parametres.length}`);
  }
  if (filtres.niveau) {
    parametres.push(filtres.niveau);
    // Les niveaux de peremption filtrent l'autre colonne.
    if (['PERIME', 'PEREMPTION_PROCHE'].includes(filtres.niveau)) {
      conditions.push(`alerte_peremption = $${parametres.length}`);
    } else {
      conditions.push(`alerte_stock = $${parametres.length}`);
    }
  }

  const clause = `WHERE ${conditions.join(' AND ')}`;

  const compteur = await query(
    `SELECT COUNT(*)::int AS total FROM v_pharmacie_alertes_stock ${clause}`,
    parametres
  );

  const { rows } = await query(
    `SELECT point_id, point_nom, produit_id, nom_commercial, quantite, seuil_alerte,
            alerte_stock, gere_lot, gere_peremption, prochaine_peremption, jours_peremption,
            alerte_peremption
     FROM v_pharmacie_alertes_stock
     ${clause}
     ORDER BY CASE
                WHEN alerte_peremption = 'PERIME' THEN 0
                WHEN alerte_stock = 'RUPTURE' THEN 1
                WHEN alerte_peremption = 'PEREMPTION_PROCHE' THEN 2
                ELSE 3
              END,
              quantite
     LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
    [...parametres, limite, offset]
  );

  const donnees = rows.map((ligne) => ({
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    produitId: ligne.produit_id,
    nomCommercial: ligne.nom_commercial,
    quantite: ligne.quantite,
    seuilAlerte: ligne.seuil_alerte,
    niveau: ligne.alerte_stock,
    niveauPeremption: ligne.alerte_peremption,
    gereLot: Boolean(ligne.gere_lot),
    gerePeremption: Boolean(ligne.gere_peremption),
    prochainePeremption: ligne.prochaine_peremption,
    joursPeremption: ligne.jours_peremption,
  }));

  return reponsePaginee(donnees, compteur.rows[0].total, { page, limite });
}