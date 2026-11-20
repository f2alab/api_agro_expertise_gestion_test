// Service du magasin central de la pharmacie.
//
// Le magasin est un point de stock dedie (pharmacie_points.type_point =
// 'MAGASIN'). Les firmes y livrent les produits ; le magasin ravitaille ensuite
// les pharmacies (siege et succursales). Toute la mecanique de stock existante
// (lots, mouvements, valorisation, alertes, FEFO) est reutilisee.

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';
import { listerAlertes, listerMouvements, listerStockValorise } from '../stocks/stocks.service.js';
import {
  creerCommande,
  enregistrerReglement,
  exigerCommande,
  listerCommandes,
  modifierCommande,
  receptionnerCommande,
} from '../commandes/commandes.service.js';

/** Recupere le magasin central actif (le premier par code). */
export async function obtenirMagasin() {
  const { rows } = await query(
    `SELECT id, code, nom, ville, telephone, adresse
       FROM pharmacie_points
      WHERE type_point = 'MAGASIN' AND actif
      ORDER BY code
      LIMIT 1`
  );
  if (!rows[0]) {
    throw ApiError.notFound("Aucun magasin central n'est configure.", 'MAGASIN_INTROUVABLE');
  }
  return {
    id: rows[0].id,
    code: rows[0].code,
    nom: rows[0].nom,
    ville: rows[0].ville ?? null,
    telephone: rows[0].telephone ?? null,
    adresse: rows[0].adresse ?? null,
  };
}

/** Identifiant du magasin, ou 404 s'il n'existe pas. */
async function exigerMagasinId() {
  return (await obtenirMagasin()).id;
}

/** Vue d'ensemble : valorisation, quantites et activite du jour. */
export async function vueEnsemble() {
  const magasin = await obtenirMagasin();
  const { rows } = await query(
    `SELECT
       (SELECT COALESCE(SUM(valeur_achat), 0) FROM v_pharmacie_stock_valorise WHERE point_id = $1) AS valeur_stock_achat,
       (SELECT COALESCE(SUM(valeur_vente), 0) FROM v_pharmacie_stock_valorise WHERE point_id = $1) AS valeur_stock_vente,
       (SELECT COALESCE(SUM(quantite), 0)::int FROM v_pharmacie_stock WHERE point_id = $1) AS quantite_totale,
       (SELECT count(*)::int FROM v_pharmacie_stock_valorise WHERE point_id = $1 AND quantite > 0) AS produits_en_stock,
       (SELECT count(*)::int FROM v_pharmacie_alertes_stock WHERE point_id = $1 AND alerte_stock = 'RUPTURE') AS produits_en_rupture,
       (SELECT count(*)::int FROM v_pharmacie_alertes_stock WHERE point_id = $1 AND alerte_stock = 'SOUS_SEUIL') AS produits_sous_seuil,
       (SELECT COALESCE(SUM(m.quantite), 0)::int FROM pharmacie_mouvements_stock m
         WHERE m.point_id = $1 AND m.type_mouvement IN ('ENTREE','TRANSFERT_ENTREE','RETOUR')
           AND m.cree_le >= CURRENT_DATE AND m.cree_le < CURRENT_DATE + 1) AS entrees_jour,
       (SELECT COALESCE(SUM(m.quantite), 0)::int FROM pharmacie_mouvements_stock m
         WHERE m.point_id = $1 AND m.type_mouvement IN ('SORTIE','TRANSFERT_SORTIE')
           AND m.cree_le >= CURRENT_DATE AND m.cree_le < CURRENT_DATE + 1) AS sorties_jour,
       (SELECT count(*)::int FROM pharmacie_commandes c
         WHERE c.point_id = $1 AND c.statut IN ('BROUILLON','ENVOYEE','PARTIELLE')) AS commandes_en_cours
    `,
    [magasin.id]
  );

  const ligne = rows[0];
  return {
    magasin,
    indicateurs: {
      valeurStockAchat: Number(ligne.valeur_stock_achat ?? 0),
      valeurStockVente: Number(ligne.valeur_stock_vente ?? 0),
      quantiteTotale: Number(ligne.quantite_totale ?? 0),
      produitsEnStock: Number(ligne.produits_en_stock ?? 0),
      produitsEnRupture: Number(ligne.produits_en_rupture ?? 0),
      produitsSousSeuil: Number(ligne.produits_sous_seuil ?? 0),
      entreesJour: Number(ligne.entrees_jour ?? 0),
      sortiesJour: Number(ligne.sorties_jour ?? 0),
      commandesEnCours: Number(ligne.commandes_en_cours ?? 0),
    },
  };
}

/** Pharmacies pouvant etre ravitaillees (siege et succursales actives). */
export async function listerDestinations() {
  const { rows } = await query(
    `SELECT id, code, nom, type_point, ville
       FROM pharmacie_points
      WHERE actif AND type_point IN ('SIEGE', 'SUCCURSALE')
      ORDER BY CASE type_point WHEN 'SIEGE' THEN 0 ELSE 1 END, nom`
  );
  return rows.map((ligne) => ({
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    typePoint: ligne.type_point,
    ville: ligne.ville ?? null,
  }));
}

/** Stock valorise du magasin (delegue au service des stocks). */
export async function listerStock(filtres = {}) {
  const magasinId = await exigerMagasinId();
  return listerStockValorise({ ...filtres, pointId: magasinId });
}

/** Mouvements du magasin : entrees fournisseurs et sorties vers les pharmacies. */
export async function listerMouvementsMagasin(filtres = {}) {
  const magasinId = await exigerMagasinId();
  return listerMouvements({ ...filtres, pointId: magasinId });
}

/** Alertes du magasin (rupture / sous le seuil). */
export async function listerAlertesMagasin(filtres = {}) {
  const magasinId = await exigerMagasinId();
  return listerAlertes({ ...filtres, pointId: magasinId });
}
/** Produits a reapprovisionner au magasin (rupture ou sous le seuil). */
export async function listerBesoins() {
  const magasinId = await exigerMagasinId();
  const { rows } = await query(
    `SELECT produit_id, produit_code, nom_commercial, categorie,
            quantite, prix_achat, prix_vente, seuil_alerte,
            GREATEST(seuil_alerte * 2 - quantite, 0) AS quantite_suggeree
       FROM v_pharmacie_stock_valorise
      WHERE point_id = $1 AND quantite <= seuil_alerte
      ORDER BY (quantite = 0) DESC, quantite, nom_commercial`,
    [magasinId]
  );

  return rows.map((ligne) => ({
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    nomCommercial: ligne.nom_commercial,
    categorie: ligne.categorie,
    quantite: ligne.quantite,
    prixAchat: Number(ligne.prix_achat),
    prixVente: Number(ligne.prix_vente),
    seuilAlerte: ligne.seuil_alerte,
    quantiteSuggeree: Number(ligne.quantite_suggeree),
  }));
}

/** Commandes d'approvisionnement du magasin (firmes). */
export async function listerCommandesMagasin(filtres = {}) {
  const magasinId = await exigerMagasinId();
  return listerCommandes({ ...filtres, pointId: magasinId });
}

/** Detail d'une commande du magasin (avec ses lignes). */
export async function detailCommandeMagasin(commandeId) {
  const magasinId = await exigerMagasinId();
  const commande = await exigerCommande(commandeId);
  if (String(commande.pointId) !== String(magasinId)) {
    throw ApiError.forbidden("Cette commande n'appartient pas au magasin.", 'COMMANDE_HORS_MAGASIN');
  }
  return commande;
}

/**
 * Modifie une commande du magasin encore ouverte (brouillon ou envoyee) :
 * enregistrement du brouillon, validation ou annulation.
 */
export async function modifierCommandeMagasin(commandeId, donnees) {
  const magasinId = await exigerMagasinId();
  const commande = await exigerCommande(commandeId);
  if (String(commande.pointId) !== String(magasinId)) {
    throw ApiError.forbidden("Cette commande n'appartient pas au magasin.", 'COMMANDE_HORS_MAGASIN');
  }
  return modifierCommande(commandeId, donnees);
}

/** Reglement d'une facture fournisseur du magasin (suivi des impayes). */
export async function reglerCommandeMagasin(commandeId, donnees, acteur = null) {
  const magasinId = await exigerMagasinId();
  const commande = await exigerCommande(commandeId);
  if (String(commande.pointId) !== String(magasinId)) {
    throw ApiError.forbidden("Cette commande n'appartient pas au magasin.", 'COMMANDE_HORS_MAGASIN');
  }
  return enregistrerReglement(commandeId, donnees, acteur);
}

/** Lance une commande fournisseur (firmes) pour le magasin. */
export async function commander(donnees, acteur = null) {
  const magasinId = await exigerMagasinId();
  return creerCommande({ ...donnees, pointId: magasinId }, acteur);
}

/** Receptionne une commande fournisseur dans le magasin. */
export async function receptionner(commandeId, donnees, acteur = null) {
  const magasinId = await exigerMagasinId();
  const commande = await exigerCommande(commandeId);
  if (String(commande.pointId) !== String(magasinId)) {
    throw ApiError.forbidden("Cette commande n'appartient pas au magasin.", 'COMMANDE_HORS_MAGASIN');
  }
  return receptionnerCommande(commandeId, donnees, acteur);
}
/**
 * Transfere un produit du magasin vers une pharmacie, lot par lot (FEFO).
 * Le stock de la pharmacie est porte par les mouvements (lot miroir a
 * quantite_entree = 0) afin de ne jamais compter deux fois la quantite.
 */
async function transfererLigne(client, contexte, acteur) {
  const { magasinId, destinationId, produit, quantite, prixUnitaire, motif, referenceId } = contexte;

  const { rows: lots } = await client.query(
    `SELECT lot_id, quantite_restante, numero_lot, date_peremption, prix_achat_unitaire
       FROM v_pharmacie_lots_stock
      WHERE point_id = $1 AND produit_id = $2 AND quantite_restante > 0
      ORDER BY date_peremption ASC NULLS LAST, lot_id`,
    [magasinId, produit.id]
  );

  let restant = quantite;
  for (const lot of lots) {
    if (restant <= 0) break;
    const pris = Math.min(restant, Number(lot.quantite_restante));
    if (pris <= 0) continue;

    await client.query(
      `INSERT INTO pharmacie_mouvements_stock
         (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
          reference_type, reference_id, utilisateur_id)
       VALUES ($1,$2,$3,'TRANSFERT_SORTIE',$4,$5,$6,'RAVITAILLEMENT',$7,$8)`,
      [magasinId, produit.id, lot.lot_id, pris, prixUnitaire, motif, referenceId, acteur?.id ?? null]
    );

    const lotDest = await client.query(
      `INSERT INTO pharmacie_lots
         (point_id, produit_id, numero_lot, date_peremption, prix_achat_unitaire, quantite_entree)
       VALUES ($1,$2,$3,$4,$5,0) RETURNING id`,
      [destinationId, produit.id, lot.numero_lot, lot.date_peremption, lot.prix_achat_unitaire ?? prixUnitaire]
    );
    await client.query(
      `INSERT INTO pharmacie_mouvements_stock
         (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
          reference_type, reference_id, utilisateur_id)
       VALUES ($1,$2,$3,'TRANSFERT_ENTREE',$4,$5,$6,'RAVITAILLEMENT',$7,$8)`,
      [destinationId, produit.id, lotDest.rows[0].id, pris, prixUnitaire, motif, referenceId, acteur?.id ?? null]
    );

    restant -= pris;
  }

  if (restant > 0) {
    await client.query(
      `INSERT INTO pharmacie_mouvements_stock
         (point_id, produit_id, type_mouvement, quantite, prix_unitaire, motif,
          reference_type, reference_id, utilisateur_id)
       VALUES ($1,$2,'TRANSFERT_SORTIE',$3,$4,$5,'RAVITAILLEMENT',$6,$7)`,
      [magasinId, produit.id, restant, prixUnitaire, motif, referenceId, acteur?.id ?? null]
    );
    await client.query(
      `INSERT INTO pharmacie_mouvements_stock
         (point_id, produit_id, type_mouvement, quantite, prix_unitaire, motif,
          reference_type, reference_id, utilisateur_id)
       VALUES ($1,$2,'TRANSFERT_ENTREE',$3,$4,$5,'RAVITAILLEMENT',$6,$7)`,
      [destinationId, produit.id, restant, prixUnitaire, motif, referenceId, acteur?.id ?? null]
    );
  }
}
/** Numero unique d'une demande de ravitaillement. */
function genererNumeroRavitaillement() {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  return `RAV-${jour}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

/** Pharmacie de destination d'un ravitaillement (siege ou succursale active). */
async function resoudreDestination(pointDestinationId, magasinId) {
  if (String(pointDestinationId) === String(magasinId)) {
    throw ApiError.badRequest('La destination doit etre une pharmacie, pas le magasin.', 'DESTINATION_MAGASIN');
  }

  const { rows } = await query(
    `SELECT id, code, nom
       FROM pharmacie_points
      WHERE id = $1 AND actif AND type_point IN ('SIEGE', 'SUCCURSALE')`,
    [pointDestinationId]
  );
  if (!rows[0]) {
    throw ApiError.notFound('Pharmacie de destination introuvable.', 'DESTINATION_INTROUVABLE');
  }
  return rows[0];
}

/**
 * Charge une commande pouvant etre ravitailee par le magasin : elle doit viser
 * le fournisseur interne « Pharmacie du Siege » (source = magasin central),
 * etre au statut ENVOYEE et, si fourni, appartenir a la pharmacie de
 * destination. Toute autre commande est refusee (hors perimetre du magasin).
 */
async function chargerCommandeARavitailler(commandeId, magasinId, destinationId = null, executeur = { query }) {
  const { rows } = await executeur.query(
    `SELECT c.id, c.numero, c.point_id, c.statut,
            f.type_fournisseur, f.point_source_id
       FROM pharmacie_commandes c
       JOIN pharmacie_fournisseurs f ON f.id = c.fournisseur_id
      WHERE c.id = $1`,
    [commandeId]
  );
  const commande = rows[0];
  if (!commande) throw ApiError.notFound('Commande introuvable.', 'COMMANDE_INTROUVABLE');

  if (destinationId && String(commande.point_id) !== String(destinationId)) {
    throw ApiError.badRequest(
      "Cette commande n'appartient pas a la pharmacie de destination.",
      'COMMANDE_AUTRE_PHARMACIE'
    );
  }
  if (
    commande.type_fournisseur !== 'INTERNE' ||
    String(commande.point_source_id) !== String(magasinId)
  ) {
    throw ApiError.badRequest(
      'Le magasin ne gere que les commandes dont le fournisseur est la pharmacie du siege.',
      'COMMANDE_FOURNISSEUR_NON_MAGASIN'
    );
  }
  if (commande.statut !== 'ENVOYEE') {
    throw ApiError.conflict('Seule une commande envoyee peut etre ravitailee.', 'COMMANDE_NON_RAVITAILLABLE');
  }
  // Un transfert deja approuve (mais pas encore receptionne) ne doit pas etre
  // duplique : la commande n'est plus proposee pour un nouveau ravitaillement.
  const { rows: dejaApprouve } = await executeur.query(
    `SELECT 1 FROM pharmacie_demandes_ravitaillement
      WHERE commande_id = $1 AND statut = 'APPROUVE'
      LIMIT 1`,
    [commandeId]
  );
  if (dejaApprouve.length > 0) {
    throw ApiError.conflict(
      'Un transfert a deja ete approuve pour cette commande : il reste a receptionner.',
      'TRANSFERT_DEJA_APPROUVE'
    );
  }
  return commande;
}

/** Transforme une commande a ravitailler en objet API. */
function serialiserCommandeARavitailler(ligne) {
  return {
    id: ligne.id,
    numero: ligne.numero,
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    fournisseurNom: ligne.fournisseur_nom,
    statut: ligne.statut,
    dateCommande: ligne.date_commande,
    dateLivraisonPrevue: ligne.date_livraison_prevue,
    totalTTC: Number(ligne.total_ttc ?? 0),
    commentaire: ligne.commentaire ?? null,
    nbLignes: Number(ligne.nb_lignes ?? 0),
    enAttente: Boolean(ligne.en_attente),
    creeParNom: ligne.cree_par_nom ?? null,
  };
}

const SELECT_COMMANDE_A_RAVITAILLER = `
  SELECT c.id, c.numero, c.point_id, c.statut, c.date_commande, c.date_livraison_prevue,
         c.total_ttc, c.commentaire,
         po.nom AS point_nom, fo.nom AS fournisseur_nom,
         (u.nom || ' ' || u.prenom) AS cree_par_nom,
         (SELECT count(*)::int FROM pharmacie_commandes_lignes l WHERE l.commande_id = c.id) AS nb_lignes,
         EXISTS (
           SELECT 1 FROM pharmacie_demandes_ravitaillement r
            WHERE r.commande_id = c.id AND r.statut = 'EN_ATTENTE'
         ) AS en_attente
    FROM pharmacie_commandes c
    JOIN pharmacie_points po       ON po.id = c.point_id
    JOIN pharmacie_fournisseurs fo ON fo.id = c.fournisseur_id
    LEFT JOIN utilisateurs u       ON u.id = c.cree_par
`;

/**
 * Commandes ENVOYEE de la pharmacie de destination dont le fournisseur est la
 * Pharmacie du Siege (source = magasin central). Le magasin ne traite aucune
 * commande dont le fournisseur n'est pas la pharmacie du siege.
 */
export async function listerCommandesARavitailler(filtres = {}) {
  const magasin = await obtenirMagasin();
  const destination = await resoudreDestination(filtres.pointDestinationId, magasin.id);

  const { rows } = await query(
    `${SELECT_COMMANDE_A_RAVITAILLER}
      WHERE c.point_id = $1
        AND c.statut = 'ENVOYEE'
        AND fo.type_fournisseur = 'INTERNE'
        AND fo.point_source_id = $2
        -- Une commande dont le transfert est deja approuve n'est plus proposee :
        -- elle attend la confirmation de reception par la pharmacie.
        AND NOT EXISTS (
          SELECT 1 FROM pharmacie_demandes_ravitaillement r
           WHERE r.commande_id = c.id AND r.statut = 'APPROUVE'
        )
      ORDER BY c.date_commande DESC, c.created_at DESC`,
    [destination.id, magasin.id]
  );
  return rows.map(serialiserCommandeARavitailler);
}

/** Detail d'une commande a ravitailler (reste a livrer et stock du magasin). */
export async function detailCommandeARavitailler(commandeId) {
  const magasin = await obtenirMagasin();
  const commande = await chargerCommandeARavitailler(commandeId, magasin.id);

  const { rows } = await query(`${SELECT_COMMANDE_A_RAVITAILLER} WHERE c.id = $1`, [commande.id]);

  const lignes = await query(
    `SELECT l.id, l.produit_id, l.quantite_commandee, l.quantite_recue, l.prix_unitaire,
            pr.code AS produit_code, pr.nom_commercial, pr.gere_lot, pr.gere_peremption,
            COALESCE(s.quantite, 0) AS stock_magasin
       FROM pharmacie_commandes_lignes l
       JOIN pharmacie_produits pr ON pr.id = l.produit_id
       LEFT JOIN v_pharmacie_stock s
         ON s.produit_id = l.produit_id AND s.point_id = $2
      WHERE l.commande_id = $1
      ORDER BY pr.nom_commercial`,
    [commande.id, magasin.id]
  );

  return {
    ...serialiserCommandeARavitailler(rows[0]),
    lignes: lignes.rows.map((ligne) => ({
      ligneId: ligne.id,
      produitId: ligne.produit_id,
      produitCode: ligne.produit_code,
      produitNom: ligne.nom_commercial,
      quantiteCommandee: ligne.quantite_commandee,
      quantiteRecue: ligne.quantite_recue,
      quantiteRestante: Math.max(0, ligne.quantite_commandee - ligne.quantite_recue),
      prixUnitaire: Number(ligne.prix_unitaire),
      stockMagasin: Number(ligne.stock_magasin ?? 0),
      gereLot: Boolean(ligne.gere_lot),
      gerePeremption: Boolean(ligne.gere_peremption),
    })),
  };
}

/** Transforme une demande de ravitaillement en objet API. */
function serialiserRavitaillement(ligne) {
  return {
    id: ligne.id,
    numero: ligne.numero,
    statut: ligne.statut,
    magasinId: ligne.magasin_id,
    magasinNom: ligne.magasin_nom ?? null,
    pointDestinationId: ligne.point_destination_id,
    pointDestinationCode: ligne.destination_code ?? null,
    pointDestinationNom: ligne.destination_nom,
    commandeId: ligne.commande_id ?? null,
    commandeNumero: ligne.commande_numero ?? null,
    /** Statut de la commande d'origine (null pour une saisie manuelle). */
    commandeStatut: ligne.commande_statut ?? null,
    /** Vrai si la pharmacie destinee a confirme la reception du transfert. */
    receptionConfirmee: Boolean(ligne.reception_confirmee),
    /**
     * Vrai si toutes les quantites transferees ont ete confirmees par la
     * pharmacie (badge « Produits recus »). Null pour une saisie manuelle.
     */
    transfertReceptionne:
      ligne.transfert_receptionne === null || ligne.transfert_receptionne === undefined
        ? null
        : Boolean(ligne.transfert_receptionne),
    commentaire: ligne.commentaire ?? null,
    motifRejet: ligne.motif_rejet ?? null,
    demandeParNom: ligne.demande_par_nom ?? null,
    valideParNom: ligne.valide_par_nom ?? null,
    valideLe: ligne.valide_le ?? null,
    creeLe: ligne.cree_le,
    nbLignes: Number(ligne.nb_lignes ?? 0),
    quantiteTotale: Number(ligne.quantite_totale ?? 0),
  };
}

const SELECT_RAVITAILLEMENT = `
  SELECT r.id, r.numero, r.statut, r.magasin_id, r.point_destination_id, r.commande_id,
         r.commentaire, r.motif_rejet, r.valide_le, r.cree_le,
         mp.nom AS magasin_nom,
         dp.nom AS destination_nom, dp.code AS destination_code,
         c.numero AS commande_numero,
         c.statut AS commande_statut,
         -- Reception confirmee par la pharmacie apres l'approbation du transfert :
         -- c'est elle qui fait passer la commande a PARTIELLE / RECUE.
         EXISTS (
           SELECT 1 FROM pharmacie_receptions rc
            WHERE rc.commande_id = r.commande_id
              AND rc.cree_le >= COALESCE(r.valide_le, r.cree_le)
         ) AS reception_confirmee,
         -- Vrai si TOUTES les quantites transferees par cette demande ont ete
         -- confirmees par la pharmacie (badge « Produits recus »), meme si la
         -- commande reste partielle (produits commandes non transferes).
         CASE
           WHEN r.commande_id IS NULL THEN NULL
           WHEN EXISTS (
             SELECT 1
               FROM pharmacie_demandes_ravitaillement_lignes rl
               JOIN pharmacie_commandes_lignes cl ON cl.id = rl.commande_ligne_id
              WHERE rl.ravitailement_id = r.id
                AND rl.quantite_transferee > cl.quantite_recue
           ) THEN FALSE
           ELSE TRUE
         END AS transfert_receptionne,
         (u.nom || ' ' || u.prenom) AS demande_par_nom,
         (v.nom || ' ' || v.prenom) AS valide_par_nom,
         (SELECT count(*)::int FROM pharmacie_demandes_ravitaillement_lignes l
           WHERE l.ravitailement_id = r.id) AS nb_lignes,
         (SELECT COALESCE(SUM(l.quantite), 0)::int FROM pharmacie_demandes_ravitaillement_lignes l
           WHERE l.ravitailement_id = r.id) AS quantite_totale
    FROM pharmacie_demandes_ravitaillement r
    JOIN pharmacie_points mp        ON mp.id = r.magasin_id
    JOIN pharmacie_points dp        ON dp.id = r.point_destination_id
    LEFT JOIN pharmacie_commandes c ON c.id = r.commande_id
    LEFT JOIN utilisateurs u        ON u.id = r.demande_par
    LEFT JOIN utilisateurs v        ON v.id = r.valide_par
`;

/** Liste paginee des demandes de ravitaillement (file de validation). */
export async function listerRavitaillements(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`r.statut = $${parametres.length}`);
  }
  if (filtres.pointDestinationId) {
    parametres.push(filtres.pointDestinationId);
    conditions.push(`r.point_destination_id = $${parametres.length}`);
  }
  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM pharmacie_demandes_ravitaillement r ${clause}`, parametres),
    query(
      `${SELECT_RAVITAILLEMENT} ${clause}
        ORDER BY r.cree_le DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserRavitaillement), compteur.rows[0].total, {
    page,
    limite,
  });
}

/** Detail d'une demande de ravitaillement, avec ses lignes. */
export async function detailRavitaillement(id) {
  const { rows } = await query(`${SELECT_RAVITAILLEMENT} WHERE r.id = $1`, [id]);
  if (!rows[0]) {
    throw ApiError.notFound('Demande de ravitaillement introuvable.', 'RAVITAILLEMENT_INTROUVABLE');
  }

  const lignes = await query(
    `SELECT l.id, l.produit_id, l.commande_ligne_id, l.quantite, l.quantite_transferee, l.prix_unitaire,
            pr.code AS produit_code, pr.nom_commercial
       FROM pharmacie_demandes_ravitaillement_lignes l
       JOIN pharmacie_produits pr ON pr.id = l.produit_id
      WHERE l.ravitailement_id = $1
      ORDER BY pr.nom_commercial`,
    [id]
  );

  return {
    ...serialiserRavitaillement(rows[0]),
    lignes: lignes.rows.map((ligne) => ({
      id: ligne.id,
      produitId: ligne.produit_id,
      produitCode: ligne.produit_code,
      produitNom: ligne.nom_commercial,
      commandeLigneId: ligne.commande_ligne_id ?? null,
      quantite: ligne.quantite,
      quantiteTransferee: ligne.quantite_transferee,
      prixUnitaire: Number(ligne.prix_unitaire),
    })),
  };
}

/**
 * Enregistre une demande de ravitaillement soumise a validation (DG / DGA).
 *
 * Aucun mouvement de stock n'est cree ici : les quantites sont seulement
 * verifiees (produit actif, stock suffisant au magasin, lignes de commande
 * valides). Le transfert reel est execute a l'approbation.
 *
 * Lorsque `commandeId` est fourni, chaque ligne doit referencer une ligne de
 * cette commande et la quantite demandee ne peut pas depasser son reste a
 * livrer. Les produits absents du magasin ou les quantites a revoir sont donc
 * simplement retires ou ajustes par l'utilisateur avant l'envoi.
 */
export async function creerRavitaillement(donnees, acteur = null) {
  const magasin = await obtenirMagasin();
  const destination = await resoudreDestination(donnees.pointDestinationId, magasin.id);

  let commande = null;
  if (donnees.commandeId) {
    commande = await chargerCommandeARavitailler(donnees.commandeId, magasin.id, destination.id);
    const { rows } = await query(
      `SELECT 1 FROM pharmacie_demandes_ravitaillement WHERE commande_id = $1 AND statut = 'EN_ATTENTE'`,
      [commande.id]
    );
    if (rows.length) {
      throw ApiError.conflict(
        'Une demande de ravitaillement est deja en attente pour cette commande.',
        'RAVITAILLEMENT_EN_ATTENTE'
      );
    }
    const { rows: dejaApprouve } = await query(
      `SELECT 1 FROM pharmacie_demandes_ravitaillement
        WHERE commande_id = $1 AND statut = 'APPROUVE'
        LIMIT 1`,
      [commande.id]
    );
    if (dejaApprouve.length > 0) {
      throw ApiError.conflict(
        'Un transfert a deja ete approuve pour cette commande : il reste a receptionner.',
        'TRANSFERT_DEJA_APPROUVE'
      );
    }
  }

  const id = await transaction(async (client) => {
    const insertion = await client.query(
      `INSERT INTO pharmacie_demandes_ravitaillement
         (numero, magasin_id, point_destination_id, commande_id, commentaire, demande_par)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        genererNumeroRavitaillement(),
        magasin.id,
        destination.id,
        commande?.id ?? null,
        donnees.commentaire ?? null,
        acteur?.id ?? null,
      ]
    );
    const ravitailementId = insertion.rows[0].id;
    const produitsVus = new Set();

    for (const ligne of donnees.lignes) {
      if (produitsVus.has(ligne.produitId)) {
        throw ApiError.badRequest(
          'Un meme produit est present plusieurs fois dans la demande.',
          'PRODUIT_DUPLIQUE'
        );
      }
      produitsVus.add(ligne.produitId);

      const { rows: produitRows } = await client.query(
        `SELECT pr.id, pr.nom_commercial, pp.prix_achat_reference
           FROM pharmacie_produits pr
           LEFT JOIN pharmacie_produits_points pp
             ON pp.produit_id = pr.id AND pp.point_id = $2
          WHERE pr.id = $1 AND pr.actif`,
        [ligne.produitId, magasin.id]
      );
      const produit = produitRows[0];
      if (!produit) {
        throw ApiError.notFound('Produit introuvable.', 'PRODUIT_INTROUVABLE', {
          produitId: ligne.produitId,
        });
      }

      const { rows: stockRows } = await client.query(
        `SELECT COALESCE(quantite, 0) AS quantite
           FROM v_pharmacie_stock WHERE point_id = $1 AND produit_id = $2`,
        [magasin.id, ligne.produitId]
      );
      const disponible = Number(stockRows[0]?.quantite ?? 0);
      if (disponible < ligne.quantite) {
        throw ApiError.conflict(
          `Stock insuffisant au magasin pour « ${produit.nom_commercial} » (disponible : ${disponible}).`,
          'STOCK_MAGASIN_INSUFFISANT',
          { produitId: ligne.produitId, disponible, demande: ligne.quantite }
        );
      }

      let commandeLigneId = null;
      if (commande) {
        if (!ligne.commandeLigneId) {
          throw ApiError.badRequest(
            'Chaque ligne doit referencer une ligne de la commande.',
            'LIGNE_COMMANDE_REQUISE'
          );
        }
        const { rows: ligneRows } = await client.query(
          `SELECT id, produit_id, quantite_commandee, quantite_recue
             FROM pharmacie_commandes_lignes
            WHERE id = $1 AND commande_id = $2`,
          [ligne.commandeLigneId, commande.id]
        );
        const ligneCommande = ligneRows[0];
        if (!ligneCommande || String(ligneCommande.produit_id) !== String(ligne.produitId)) {
          throw ApiError.badRequest(
            'Ligne de commande incompatible avec le produit demande.',
            'LIGNE_COMMANDE_INVALIDE'
          );
        }
        const reste = ligneCommande.quantite_commandee - ligneCommande.quantite_recue;
        if (ligne.quantite > reste) {
          throw ApiError.badRequest(
            `La quantite depasse le reste a livrer de la commande (${reste}).`,
            'QUANTITE_SUPERIEURE_COMMANDE',
            { produitId: ligne.produitId, reste, demande: ligne.quantite }
          );
        }
        commandeLigneId = ligneCommande.id;
      }

      await client.query(
        `INSERT INTO pharmacie_demandes_ravitaillement_lignes
           (ravitailement_id, produit_id, commande_ligne_id, quantite, prix_unitaire)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          ravitailementId,
          ligne.produitId,
          commandeLigneId,
          ligne.quantite,
          Number(produit.prix_achat_reference ?? 0),
        ]
      );
    }

    return ravitailementId;
  });

  return detailRavitaillement(id);
}

/**
 * Approuve une demande de ravitaillement (DG / DGA) : execute reellement le
 * transfert du magasin vers la pharmacie (lot par lot, FEFO), puis solde la
 * commande d'origine lorsqu'elle est renseignee.
 */
export async function approuverRavitaillement(id, acteur = null) {
  const demande = await detailRavitaillement(id);
  if (demande.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict('Cette demande a deja ete traitee.', 'RAVITAILLEMENT_TRAITE');
  }
  const magasin = await obtenirMagasin();

  await transaction(async (client) => {
    const verrou = await client.query(
      'SELECT statut FROM pharmacie_demandes_ravitaillement WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!verrou.rows[0] || verrou.rows[0].statut !== 'EN_ATTENTE') {
      throw ApiError.conflict('Cette demande a deja ete traitee.', 'RAVITAILLEMENT_TRAITE');
    }

    const complement = demande.commentaire ? ` - ${demande.commentaire}` : '';
    const motif = `Ravitaillement de ${demande.pointDestinationNom} depuis le magasin${complement}`;

    for (const ligne of demande.lignes) {
      const { rows: produitRows } = await client.query(
        `SELECT pr.id, pr.nom_commercial, pp.prix_achat_reference
           FROM pharmacie_produits pr
           LEFT JOIN pharmacie_produits_points pp
             ON pp.produit_id = pr.id AND pp.point_id = $2
          WHERE pr.id = $1 AND pr.actif`,
        [ligne.produitId, magasin.id]
      );
      const produit = produitRows[0];
      if (!produit) {
        throw ApiError.notFound('Produit introuvable.', 'PRODUIT_INTROUVABLE', {
          produitId: ligne.produitId,
        });
      }

      const { rows: stockRows } = await client.query(
        `SELECT COALESCE(quantite, 0) AS quantite
           FROM v_pharmacie_stock WHERE point_id = $1 AND produit_id = $2`,
        [magasin.id, ligne.produitId]
      );
      const disponible = Number(stockRows[0]?.quantite ?? 0);
      if (disponible < ligne.quantite) {
        throw ApiError.conflict(
          `Stock insuffisant au magasin pour « ${produit.nom_commercial} » (disponible : ${disponible}).`,
          'STOCK_MAGASIN_INSUFFISANT',
          { produitId: ligne.produitId, disponible, demande: ligne.quantite }
        );
      }

      const prixUnitaire = Number(ligne.prixUnitaire ?? produit.prix_achat_reference ?? 0);

      await client.query(
        `INSERT INTO pharmacie_produits_points
           (produit_id, point_id, prix_vente, prix_achat_reference, seuil_alerte, disponible)
         VALUES ($1,$2,$3,$4,0,TRUE)
         ON CONFLICT (produit_id, point_id) DO NOTHING`,
        [ligne.produitId, demande.pointDestinationId, prixUnitaire, prixUnitaire]
      );

      await transfererLigne(
        client,
        {
          magasinId: magasin.id,
          destinationId: demande.pointDestinationId,
          produit,
          quantite: ligne.quantite,
          prixUnitaire,
          motif,
          referenceId: demande.id,
        },
        acteur
      );

      await client.query(
        'UPDATE pharmacie_demandes_ravitaillement_lignes SET quantite_transferee = $1 WHERE id = $2',
        [ligne.quantite, ligne.id]
      );
    }

    await client.query(
      `UPDATE pharmacie_demandes_ravitaillement
          SET statut = 'APPROUVE', valide_par = $1, valide_le = now(), maj_le = now()
        WHERE id = $2`,
      [acteur?.id ?? null, demande.id]
    );

    // Le transfert de stock est execute (mouvements, lots et valorisation), mais
    // la commande liee reste ENVOYEE : c'est la confirmation de reception par la
    // pharmacie destinataire qui la fera passer a PARTIELLE / RECUE
    // (voir receptionnerCommande).
  });

  return detailRavitaillement(id);
}

/** Rejette une demande : aucun stock n'est deplace, la commande reste ouverte. */
export async function rejeterRavitaillement(id, donnees = {}, acteur = null) {
  const demande = await detailRavitaillement(id);
  if (demande.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict('Cette demande a deja ete traitee.', 'RAVITAILLEMENT_TRAITE');
  }

  await query(
    `UPDATE pharmacie_demandes_ravitaillement
        SET statut = 'REJETE', motif_rejet = $1, valide_par = $2, valide_le = now(), maj_le = now()
      WHERE id = $3 AND statut = 'EN_ATTENTE'`,
    [donnees.motif ?? null, acteur?.id ?? null, id]
  );

  return detailRavitaillement(id);
}
/**
 * Fournisseurs externes (firmes) actifs, quel que soit leur rattachement.
 * Le magasin est l'entite qui commande aux firmes : cette liste est donc
 * independante du cloisonnement d'un responsable rattache a une pharmacie.
 */
export async function listerFournisseursExternes() {
  const { rows } = await query(
    `SELECT id, code, nom, conditions_paiement, delai_livraison_jours
       FROM pharmacie_fournisseurs
      WHERE actif AND type_fournisseur = 'EXTERNE'
      ORDER BY nom`
  );
  return rows.map((ligne) => ({
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    conditionsPaiement: ligne.conditions_paiement ?? null,
    delaiLivraisonJours: ligne.delai_livraison_jours ?? null,
  }));
}