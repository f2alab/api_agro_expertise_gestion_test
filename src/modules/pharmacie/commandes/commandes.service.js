// Service des commandes d'approvisionnement de la pharmacie.
// Une commande est passee a un fournisseur pour un point de vente. Sa reception
// genere les lots et les entrees de stock correspondantes.

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';
import { perimetreUtilisateur } from '../../../utils/perimetre.js';
import { enregistrerFlux } from '../../finances/ledger.service.js';
import { consommerLotsFEFO } from '../stocks/stocks.service.js';

const SELECT_COMMANDE = `
  SELECT c.id, c.numero, c.point_id, c.fournisseur_id, c.statut, c.cree_par, c.date_commande,
         c.date_livraison_prevue, c.total_ht, c.total_tva, c.total_ttc, c.commentaire,
         c.created_at, c.updated_at,
         po.nom  AS point_nom,
         fo.nom  AS fournisseur_nom,
         fo.type_fournisseur AS fournisseur_type,
         fo.point_source_id AS fournisseur_point_source_id,
         -- Vrai si le fournisseur interne est le magasin central : la reception
         -- est alors assuree par le transfert approuve (pas de reception manuelle).
         EXISTS (
           SELECT 1 FROM pharmacie_points pm
            WHERE pm.id = fo.point_source_id AND pm.type_point = 'MAGASIN'
         ) AS fournisseur_magasin,
         (SELECT COALESCE(SUM(g.montant), 0)
            FROM pharmacie_reglements g
           WHERE g.commande_id = c.id AND g.statut = 'VALIDE') AS montant_paye,
         (SELECT COALESCE(SUM(g.montant), 0)
            FROM pharmacie_reglements g
           WHERE g.commande_id = c.id AND g.statut = 'EN_ATTENTE') AS montant_en_attente,
         (u.nom || ' ' || u.prenom) AS cree_par_nom,
         derniere_reception.date_reception,
         derniere_reception.recepteur_nom,
         -- Demande de ravitaillement du magasin en attente de validation : la
         -- reception de la commande est interdite tant qu'elle n'est pas approuvee.
         EXISTS (
           SELECT 1 FROM pharmacie_demandes_ravitaillement r
            WHERE r.commande_id = c.id AND r.statut = 'EN_ATTENTE'
         ) AS transfert_en_attente,
         -- Un transfert a ete approuve : la reception peut etre confirmee par la
         -- pharmacie destinataire (la commande n'est plus modifiable).
         EXISTS (
           SELECT 1 FROM pharmacie_demandes_ravitaillement r
            WHERE r.commande_id = c.id AND r.statut = 'APPROUVE'
         ) AS transfert_approuve,
         (SELECT r.numero
            FROM pharmacie_demandes_ravitaillement r
           WHERE r.commande_id = c.id AND r.statut = 'APPROUVE'
           ORDER BY r.valide_le DESC NULLS LAST
           LIMIT 1) AS transfert_numero
  FROM pharmacie_commandes c
  JOIN pharmacie_points po      ON po.id = c.point_id
  JOIN pharmacie_fournisseurs fo ON fo.id = c.fournisseur_id
  LEFT JOIN utilisateurs u ON u.id = c.cree_par
  -- Derniere reception : qui a receptionne la commande et quand.
  LEFT JOIN LATERAL (
    SELECT r.date_reception, (rr.nom || ' ' || rr.prenom) AS recepteur_nom
      FROM pharmacie_receptions r
      LEFT JOIN utilisateurs rr ON rr.id = r.recepteur_id
     WHERE r.commande_id = c.id
     ORDER BY r.cree_le DESC
     LIMIT 1
  ) derniere_reception ON TRUE
`;

/**
 * Statut de reglement d'une commande fournisseur : rien de verse, demande en
 * attente de validation, verse en partie ou solde (tolerance au centime).
 */
function statutReglementCommande(montantPaye, totalTTC, montantEnAttente = 0) {
  if (totalTTC <= 0) return 'PAYEE';
  if (montantPaye + 0.01 >= totalTTC) return 'PAYEE';
  if (montantPaye > 0) return 'PARTIELLE';
  if (montantEnAttente > 0) return 'A_VALIDER';
  return 'NON_PAYEE';
}

/** Transforme une ligne de commande en objet API. */
function serialiserCommande(ligne) {
  if (!ligne) return null;
  const totalTTC = Number(ligne.total_ttc);
  const montantPaye = Number(ligne.montant_paye ?? 0);
  const montantEnAttente = Number(ligne.montant_en_attente ?? 0);
  // Un fournisseur interne (transfert dans le groupe) ne donne lieu a aucun
  // reglement : le suivi des impayes ne s'applique pas.
  const suiviReglement = ligne.fournisseur_type !== 'INTERNE';
  return {
    id: ligne.id,
    numero: ligne.numero,
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    fournisseurId: ligne.fournisseur_id,
    fournisseurNom: ligne.fournisseur_nom,
    // Type de fournisseur : un fournisseur interne (transfert dans le groupe) ne
    // donne lieu a aucun reglement, l'interface masque alors les champs facture.
    fournisseurType: ligne.fournisseur_type ?? null,
    // Vrai si le fournisseur est le magasin central : la reception est realisee
    // par le transfert approuve par le DG / DGA, jamais manuellement.
    receptionParTransfert: Boolean(ligne.fournisseur_magasin),
    // Vrai si une demande de ravitaillement du magasin central est en attente
    // de validation : la reception est bloquee tant qu'elle n'est pas approuvee.
    transfertEnAttente: Boolean(ligne.transfert_en_attente),
    // Un transfert du magasin a ete approuve : la reception (confirmation des
    // quantites transferees) est desormais possible.
    transfertApprouve: Boolean(ligne.transfert_approuve),
    transfertNumero: ligne.transfert_numero ?? null,
    statut: ligne.statut,
    creeParId: ligne.cree_par ?? null,
    dateCommande: ligne.date_commande,
    dateLivraisonPrevue: ligne.date_livraison_prevue,
    totalHT: Number(ligne.total_ht),
    totalTVA: Number(ligne.total_tva),
    totalTTC,
    // Suivi du reglement fournisseur (impayes) : montant verse, reste a payer et
    // statut deduit (null pour un transfert interne).
    montantPaye: suiviReglement ? montantPaye : 0,
    montantEnAttente: suiviReglement ? montantEnAttente : 0,
    resteAPayer: suiviReglement ? Math.max(totalTTC - montantPaye, 0) : 0,
    statutReglement: suiviReglement
      ? statutReglementCommande(montantPaye, totalTTC, montantEnAttente)
      : null,
    // Derniere reception : date et recepteur (tracabilite de l'entree de stock).
    dateReception: ligne.date_reception ?? null,
    recepteurNom: ligne.recepteur_nom ?? null,
    commentaire: ligne.commentaire ?? null,
    creeParNom: ligne.cree_par_nom ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Transforme une ligne de detail (lignes de commande) en objet API. */
function serialiserLigne(ligne) {
  return {
    id: ligne.id,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    produitNom: ligne.produit_nom,
    quantiteCommandee: ligne.quantite_commandee,
    quantiteRecue: ligne.quantite_recue,
    /** Quantite deja transferee par un ravitaillement approuve (magasin). */
    quantiteTransferee: Number(ligne.quantite_transferee ?? 0),
    prixUnitaire: Number(ligne.prix_unitaire),
    remise: Number(ligne.remise),
    totalLigne: Number(ligne.total_ligne),
    // Suivi du produit : permet a la reception d'exiger la date de peremption.
    gereLot: Boolean(ligne.gere_lot),
    gerePeremption: Boolean(ligne.gere_peremption),
  };
}

/** Genere un numero unique (prefixe + date + sequence + suffixe aleatoire). */
function genererNumero(prefixe) {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  const suffixe = randomUUID().slice(0, 4).toUpperCase();
  return `${prefixe}-${jour}-${suffixe}`;
}

/** Liste paginee des commandes. */
export async function listerCommandes(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`c.point_id = $${parametres.length}`);
  }
  if (filtres.fournisseurId) {
    parametres.push(filtres.fournisseurId);
    conditions.push(`c.fournisseur_id = $${parametres.length}`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`c.statut = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM pharmacie_commandes c ${clause}`, parametres),
    query(
      `${SELECT_COMMANDE} ${clause}
       ORDER BY c.date_commande DESC, c.created_at DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserCommande), compteur.rows[0].total, { page, limite });
}

/** Recupere une commande avec ses lignes, ou null. */
export async function obtenirCommande(id) {
  const { rows } = await query(`${SELECT_COMMANDE} WHERE c.id = $1`, [id]);
  if (!rows[0]) return null;

  const lignes = await query(
    `SELECT l.*, pr.code AS produit_code, pr.nom_commercial AS produit_nom,
            pr.gere_lot, pr.gere_peremption,
            -- Quantite deja transferee par un ravitaillement approuve (magasin).
            COALESCE((
              SELECT SUM(rl.quantite_transferee)
                FROM pharmacie_demandes_ravitaillement_lignes rl
                JOIN pharmacie_demandes_ravitaillement r ON r.id = rl.ravitailement_id
               WHERE rl.commande_ligne_id = l.id AND r.statut = 'APPROUVE'
            ), 0) AS quantite_transferee
     FROM pharmacie_commandes_lignes l
     JOIN pharmacie_produits pr ON pr.id = l.produit_id
     WHERE l.commande_id = $1
     ORDER BY pr.nom_commercial`,
    [id]
  );

  const commande = serialiserCommande(rows[0]);
  commande.lignes = lignes.rows.map(serialiserLigne);

  // Versements (demandes et reglements valides) : utiles au detail de la
  // commande et a l'ecran de validation.
  const reglements = await query(
    `SELECT g.id, g.commande_id, g.date_reglement, g.montant, g.mode, g.reference, g.commentaire,
            g.statut, g.cree_le, g.valide_le,
            (u.nom || ' ' || u.prenom) AS cree_par_nom,
            (v.nom || ' ' || v.prenom) AS valide_par_nom
       FROM pharmacie_reglements g
       LEFT JOIN utilisateurs u ON u.id = g.cree_par
       LEFT JOIN utilisateurs v ON v.id = g.valide_par
      WHERE g.commande_id = $1
      ORDER BY g.date_reglement, g.cree_le`,
    [id]
  );
  commande.reglements = reglements.rows.map((ligne) => ({
    id: ligne.id,
    commandeId: ligne.commande_id,
    dateReglement: ligne.date_reglement,
    montant: Number(ligne.montant),
    mode: ligne.mode,
    reference: ligne.reference ?? null,
    commentaire: ligne.commentaire ?? null,
    statut: ligne.statut,
    creeLe: ligne.cree_le,
    creeParNom: ligne.cree_par_nom ?? null,
    valideLe: ligne.valide_le ?? null,
    valideParNom: ligne.valide_par_nom ?? null,
  }));

  // Receptions (factures fournisseurs) : date, recepteur, facture.
  const receptions = await query(
    `SELECT r.id, r.date_reception, r.numero_facture, r.montant_facture, r.commentaire, r.cree_le,
            (u.nom || ' ' || u.prenom) AS recepteur_nom
       FROM pharmacie_receptions r
       LEFT JOIN utilisateurs u ON u.id = r.recepteur_id
      WHERE r.commande_id = $1
      ORDER BY r.cree_le DESC`,
    [id]
  );
  commande.receptions = receptions.rows.map((ligne) => ({
    id: ligne.id,
    dateReception: ligne.date_reception,
    numeroFacture: ligne.numero_facture ?? null,
    montantFacture: Number(ligne.montant_facture),
    commentaire: ligne.commentaire ?? null,
    creeLe: ligne.cree_le,
    recepteurNom: ligne.recepteur_nom ?? null,
  }));

  return commande;
}

/** Recupere une commande ou leve une 404. */
export async function exigerCommande(id) {
  const commande = await obtenirCommande(id);
  if (!commande) throw ApiError.notFound('Commande introuvable.', 'COMMANDE_INTROUVABLE');
  return commande;
}

/** Remplace les lignes d'une commande (utilise a la creation et a la modification). */
async function remplacerLignes(client, commandeId, lignes) {
  await client.query('DELETE FROM pharmacie_commandes_lignes WHERE commande_id = $1', [commandeId]);
  for (const ligne of lignes) {
    const remise = ligne.remise ?? 0;
    const total = Math.round((ligne.quantiteCommandee * ligne.prixUnitaire - remise) * 100) / 100;
    await client.query(
      `INSERT INTO pharmacie_commandes_lignes
         (commande_id, produit_id, quantite_commandee, prix_unitaire, remise, total_ligne)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [commandeId, ligne.produitId, ligne.quantiteCommandee, ligne.prixUnitaire, remise, total]
    );
  }
}

/** Recalcule les totaux HT / TVA / TTC d'une commande a partir de ses lignes. */
async function recalculerTotaux(client, commandeId) {
  await client.query(
    `UPDATE pharmacie_commandes c
     SET total_ht = COALESCE(t.ht, 0),
         total_tva = COALESCE(t.tva, 0),
         total_ttc = COALESCE(t.ttc, 0)
     FROM (
       SELECT l.commande_id,
              SUM(l.total_ligne) AS ht,
              SUM(l.total_ligne * COALESCE(pr.tva_taux, 0) / 100) AS tva,
              SUM(l.total_ligne * (1 + COALESCE(pr.tva_taux, 0) / 100)) AS ttc
       FROM pharmacie_commandes_lignes l
       JOIN pharmacie_produits pr ON pr.id = l.produit_id
       WHERE l.commande_id = $1
       GROUP BY l.commande_id
     ) t
     WHERE c.id = $1 AND t.commande_id = c.id`,
    [commandeId]
  );
}

/** Cree une commande d'approvisionnement avec ses lignes. */
export async function creerCommande(donnees, acteur = null) {
  // Le fournisseur doit appartenir a la pharmacie de la commande (s'il est
  // rattache a une pharmacie) : empeche de commander chez le fournisseur d'une
  // autre pharmacie.
  const { rows: fournisseurRows } = await query(
    'SELECT point_id, type_fournisseur FROM pharmacie_fournisseurs WHERE id = $1',
    [donnees.fournisseurId]
  );
  if (fournisseurRows.length === 0) {
    throw ApiError.notFound('Fournisseur introuvable.', 'FOURNISSEUR_INTROUVABLE');
  }
  const pointFournisseur = fournisseurRows[0].point_id;
  if (pointFournisseur && String(pointFournisseur) !== String(donnees.pointId)) {
    // Le magasin central approvisionne tout le reseau : il peut commander aupres
    // de n'importe quelle firme externe, meme rattachee a la pharmacie du siege.
    const { rows: magasinRows } = await query(
      "SELECT 1 FROM pharmacie_points WHERE id = $1 AND type_point = 'MAGASIN'",
      [donnees.pointId]
    );
    const magasinEtFirme = fournisseurRows[0].type_fournisseur === 'EXTERNE' && magasinRows.length > 0;
    if (!magasinEtFirme) {
      throw ApiError.forbidden(
        'Ce fournisseur appartient a une autre pharmacie.',
        'FOURNISSEUR_HORS_PERIMETRE'
      );
    }
  }

  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO pharmacie_commandes
         (numero, point_id, fournisseur_id, statut, date_commande, date_livraison_prevue, commentaire, cree_par)
       VALUES ($1,$2,$3, COALESCE($4::text, 'BROUILLON'), COALESCE($5::date, CURRENT_DATE), $6, $7, $8)
       RETURNING id`,
      [
        genererNumero('CMD'),
        donnees.pointId,
        donnees.fournisseurId,
        donnees.statut ?? null,
        donnees.dateCommande ?? null,
        donnees.dateLivraisonPrevue ?? null,
        donnees.commentaire ?? null,
        acteur?.id ?? null,
      ]
    );
    const commandeId = rows[0].id;
    await remplacerLignes(client, commandeId, donnees.lignes);
    await recalculerTotaux(client, commandeId);
    return commandeId;
  });

  return obtenirCommande(id);
}

/** Modifie une commande encore ouverte (brouillon ou envoyee). */
export async function modifierCommande(id, donnees) {
  const commande = await exigerCommande(id);
  if (!['BROUILLON', 'ENVOYEE'].includes(commande.statut)) {
    throw ApiError.conflict(
      'Seules les commandes en brouillon ou envoyees peuvent etre modifiees.',
      'COMMANDE_NON_MODIFIABLE'
    );
  }

  await transaction(async (client) => {
    const champs = [];
    const valeurs = [];
    const ajouter = (colonne, valeur) => {
      valeurs.push(valeur);
      champs.push(`${colonne} = $${valeurs.length}`);
    };

    if (donnees.statut !== undefined) ajouter('statut', donnees.statut);
    if (donnees.dateLivraisonPrevue !== undefined) ajouter('date_livraison_prevue', donnees.dateLivraisonPrevue);
    if (donnees.commentaire !== undefined) ajouter('commentaire', donnees.commentaire || null);

    if (champs.length > 0) {
      valeurs.push(id);
      await client.query(
        `UPDATE pharmacie_commandes SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
        valeurs
      );
    }
    if (donnees.lignes) {
      await remplacerLignes(client, id, donnees.lignes);
      await recalculerTotaux(client, id);
    }
  });

  return obtenirCommande(id);
}

/**
 * Receptionne une commande : cree les lots et les entrees de stock pour chaque
 * ligne receptionnee, puis met a jour le statut (PARTIELLE ou RECUE).
 */
export async function receptionnerCommande(id, donnees, acteur = null) {
  const commande = await exigerCommande(id);
  if (['RECUE', 'ANNULEE'].includes(commande.statut)) {
    throw ApiError.conflict('Cette commande est deja cloturee.', 'COMMANDE_CLOTUREE');
  }

  // Fournisseur INTERNE ? La pharmacie source (ex. le siege) doit alors etre
  // debitee du stock lors de la reception (approvisionnement intra-reseau).
  const { rows: fournisseurRows } = await query(
    `SELECT f.type_fournisseur, f.point_source_id,
            EXISTS (
              SELECT 1 FROM pharmacie_points p
               WHERE p.id = f.point_source_id AND p.type_point = 'MAGASIN'
            ) AS source_magasin
       FROM pharmacie_fournisseurs f
      WHERE f.id = $1`,
    [commande.fournisseurId]
  );
  const pointSource =
    fournisseurRows[0]?.type_fournisseur === 'INTERNE'
      ? fournisseurRows[0]?.point_source_id ?? null
      : null;
  const sourceMagasin = Boolean(fournisseurRows[0]?.source_magasin);

  // Une demande de ravitaillement liee a cette commande est en attente de
  // validation (DG / DGA) : le stock n'a pas encore ete transfere, la reception
  // est donc interdite pour eviter une double entree.
  const { rows: transfertsEnAttente } = await query(
    `SELECT 1 FROM pharmacie_demandes_ravitaillement
      WHERE commande_id = $1 AND statut = 'EN_ATTENTE'
      LIMIT 1`,
    [id]
  );
  if (transfertsEnAttente.length > 0) {
    throw ApiError.conflict(
      "Le transfert de cette commande est en attente de validation par le DG ou le DGA.",
      'TRANSFERT_NON_APPROUVE'
    );
  }

  // Un transfert du magasin a-t-il deja ete approuve pour cette commande ?
  const { rows: transfertsApprouves } = await query(
    `SELECT r.id, r.numero
       FROM pharmacie_demandes_ravitaillement r
      WHERE r.commande_id = $1 AND r.statut = 'APPROUVE'
      ORDER BY r.valide_le DESC NULLS LAST
      LIMIT 1`,
    [id]
  );
  const transfertApprouve = transfertsApprouves[0] ?? null;

  // Fournisseur = magasin central sans transfert approuve : le stock n'a pas
  // encore ete transfere, la reception manuelle est interdite.
  if (sourceMagasin && !transfertApprouve) {
    throw ApiError.conflict(
      "La réception de cette commande est possible après approbation du transfert par le DG ou le DGA.",
      'RECEPTION_PAR_TRANSFERT_REQUISE'
    );
  }

  // Transfert approuve : la reception est une confirmation des quantites deja
  // transferees. Le stock (lots et mouvements) a ete positionne par le
  // transfert : aucun lot, mouvement, facture ou reglement n'est cree ici.
  if (transfertApprouve) {
    await transaction(async (client) => {
      let lignesConfirmees = 0;

      for (const reception of donnees.lignes) {
        if (!reception.quantiteRecue || reception.quantiteRecue <= 0) continue;

        const { rows } = await client.query(
          `SELECT l.id, l.quantite_commandee, l.quantite_recue,
                  COALESCE((
                    SELECT SUM(rl.quantite_transferee)
                      FROM pharmacie_demandes_ravitaillement_lignes rl
                     WHERE rl.ravitailement_id = $3 AND rl.commande_ligne_id = l.id
                  ), 0) AS quantite_transferee
             FROM pharmacie_commandes_lignes l
            WHERE l.id = $1 AND l.commande_id = $2`,
          [reception.ligneId, id, transfertApprouve.id]
        );
        const ligne = rows[0];
        if (!ligne) {
          throw ApiError.notFound('Ligne de commande introuvable.', 'LIGNE_INTROUVABLE');
        }

        const resteCommande = ligne.quantite_commandee - ligne.quantite_recue;
        const receptionnable = Math.max(
          0,
          Number(ligne.quantite_transferee) - Number(ligne.quantite_recue)
        );
        const quantite = Math.min(reception.quantiteRecue, resteCommande, receptionnable);
        if (quantite <= 0) continue;

        await client.query(
          'UPDATE pharmacie_commandes_lignes SET quantite_recue = quantite_recue + $1 WHERE id = $2',
          [quantite, ligne.id]
        );
        lignesConfirmees += 1;
      }

      if (lignesConfirmees === 0) {
        throw ApiError.conflict(
          'Aucune quantité transférée ne reste à réceptionner pour cette commande.',
          'AUCUNE_QUANTITE_A_RECEPTIONNER'
        );
      }

      const etat = await client.query(
        `SELECT COALESCE(SUM(quantite_commandee), 0) AS commandee,
                COALESCE(SUM(quantite_recue), 0) AS recue
           FROM pharmacie_commandes_lignes WHERE commande_id = $1`,
        [id]
      );
      const { commandee, recue } = etat.rows[0];
      const statut =
        Number(recue) >= Number(commandee)
          ? 'RECUE'
          : Number(recue) > 0
            ? 'PARTIELLE'
            : commande.statut;

      await client.query(
        'UPDATE pharmacie_commandes SET statut = $1, valide_par = $2 WHERE id = $3',
        [statut, acteur?.id ?? null, id]
      );

      await client.query(
        `INSERT INTO pharmacie_receptions
           (commande_id, point_id, date_reception, commentaire, recepteur_id)
         VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), $4, $5)`,
        [
          id,
          commande.pointId,
          donnees.dateReception ?? null,
          donnees.commentaire ?? `Réception du transfert ${transfertApprouve.numero}`,
          acteur?.id ?? null,
        ]
      );
    });

    return obtenirCommande(id);
  }

  await transaction(async (client) => {
    for (const reception of donnees.lignes) {
      if (!reception.quantiteRecue || reception.quantiteRecue <= 0) continue;

      const { rows } = await client.query(
        `SELECT l.id, l.produit_id, l.quantite_commandee, l.quantite_recue, l.prix_unitaire,
                pr.nom_commercial, pr.gere_lot, pr.gere_peremption
         FROM pharmacie_commandes_lignes l
         JOIN pharmacie_produits pr ON pr.id = l.produit_id
         WHERE l.id = $1 AND l.commande_id = $2`,
        [reception.ligneId, id]
      );
      const ligne = rows[0];
      if (!ligne) throw ApiError.notFound('Ligne de commande introuvable.', 'LIGNE_INTROUVABLE');

      const reste = ligne.quantite_commandee - ligne.quantite_recue;
      const quantite = Math.min(reception.quantiteRecue, reste);
      if (quantite <= 0) continue;

      // Produit suivi par date de peremption : la date est obligatoire, comme
      // pour toute entree de stock (aucune exception a la reception).
      const datePeremption = reception.datePeremption
        ? String(reception.datePeremption).slice(0, 10)
        : null;
      if (ligne.gere_peremption && !datePeremption) {
        throw ApiError.badRequest(
          `La date de peremption est obligatoire pour le produit « ${ligne.nom_commercial} ».`,
          'PEREMPTION_REQUISE',
          { ligneId: ligne.id, produitId: ligne.produit_id }
        );
      }

      const lot = await client.query(
        `INSERT INTO pharmacie_lots
           (point_id, produit_id, numero_lot, date_peremption, prix_achat_unitaire, quantite_entree)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          commande.pointId,
          ligne.produit_id,
          reception.numeroLot ?? null,
          datePeremption,
          ligne.prix_unitaire,
          quantite,
        ]
      );

      await client.query(
        `INSERT INTO pharmacie_mouvements_stock
           (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
            reference_type, reference_id, utilisateur_id)
         VALUES ($1,$2,$3,'ENTREE',$4,$5,$6,'COMMANDE',$7,$8)`,
        [
          commande.pointId,
          ligne.produit_id,
          lot.rows[0].id,
          quantite,
          ligne.prix_unitaire,
          `Reception ${commande.numero}`,
          id,
          acteur?.id ?? null,
        ]
      );

      // La succursale recoit le produit : il entre dans SA liste locale (s'il
      // n'y est pas encore) pour etre visible et vendable, sans ecraser ses
      // prix existants.
      await client.query(
        `INSERT INTO pharmacie_produits_points
           (produit_id, point_id, prix_vente, prix_achat_reference, seuil_alerte, disponible)
         VALUES ($1,$2,$3,$4,0,TRUE)
         ON CONFLICT (produit_id, point_id) DO NOTHING`,
        [ligne.produit_id, commande.pointId, ligne.prix_unitaire, ligne.prix_unitaire]
      );

      await client.query(
        'UPDATE pharmacie_commandes_lignes SET quantite_recue = quantite_recue + $1 WHERE id = $2',
        [quantite, ligne.id]
      );

      // Approvisionnement interne : la contrepartie est une SORTIE de stock sur
      // la pharmacie source (le siege), apres controle de sa disponibilite.
      if (pointSource) {
        const { rows: stockSource } = await client.query(
          `SELECT COALESCE(quantite, 0) AS quantite FROM v_pharmacie_stock
           WHERE point_id = $1 AND produit_id = $2`,
          [pointSource, ligne.produit_id]
        );
        const disponibleSource = Number(stockSource[0]?.quantite ?? 0);
        if (disponibleSource < quantite) {
          throw ApiError.conflict(
            `Stock insuffisant sur la pharmacie source pour le transfert (disponible ${disponibleSource}).`,
            'STOCK_SOURCE_INSUFFISANT'
          );
        }
        const motifTransfert = `Transfert interne vers ${commande.pointNom ?? 'pharmacie'} (${commande.numero})`;
        // Produit gere par lot : la source est debitee en FEFO (un mouvement par
        // lot), afin que les quantites restantes des lots restent exactes.
        const { rows: produitRows } = await client.query(
          'SELECT gere_lot FROM pharmacie_produits WHERE id = $1',
          [ligne.produit_id]
        );
        if (produitRows[0]?.gere_lot) {
          await consommerLotsFEFO(
            client,
            {
              pointId: pointSource,
              produitId: ligne.produit_id,
              typeMouvement: 'TRANSFERT_SORTIE',
              quantite,
              prixUnitaire: ligne.prix_unitaire,
              motif: motifTransfert,
              referenceType: 'COMMANDE',
              referenceId: id,
            },
            acteur
          );
        } else {
          await client.query(
            `INSERT INTO pharmacie_mouvements_stock
               (point_id, produit_id, type_mouvement, quantite, prix_unitaire, motif,
                reference_type, reference_id, utilisateur_id)
             VALUES ($1,$2,'TRANSFERT_SORTIE',$3,$4,$5,'COMMANDE',$6,$7)`,
            [
              pointSource,
              ligne.produit_id,
              quantite,
              ligne.prix_unitaire,
              motifTransfert,
              id,
              acteur?.id ?? null,
            ]
          );
        }
      }
    }

    const etat = await client.query(
      `SELECT COALESCE(SUM(quantite_commandee), 0) AS commandee,
              COALESCE(SUM(quantite_recue), 0) AS recue
       FROM pharmacie_commandes_lignes WHERE commande_id = $1`,
      [id]
    );
    const { commandee, recue } = etat.rows[0];
    const statut = Number(recue) >= Number(commandee) ? 'RECUE' : Number(recue) > 0 ? 'PARTIELLE' : commande.statut;

    await client.query('UPDATE pharmacie_commandes SET statut = $1, valide_par = $2 WHERE id = $3', [
      statut,
      acteur?.id ?? null,
      id,
    ]);

    const receptionInseree = await client.query(
      `INSERT INTO pharmacie_receptions
         (commande_id, point_id, date_reception, numero_facture, montant_facture, commentaire, recepteur_id)
       VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7)
       RETURNING id`,
      [
        id,
        commande.pointId,
        donnees.dateReception ?? null,
        donnees.numeroFacture ?? null,
        donnees.montantFacture ?? 0,
        donnees.commentaire ?? null,
        acteur?.id ?? null,
      ]
    );
    const receptionId = receptionInseree.rows[0].id;

    // Facture fournisseur : le montant declare a la reception devient une
    // *demande de reglement* (statut EN_ATTENTE). L'ecriture de tresorerie
    // SORTIE / ACHAT n'est creee qu'a la validation par l'administration
    // (voir validerReglement), afin qu'aucune sortie d'argent ne soit constatee
    // sans approbation.
    //
    // Un transfert interne (siege -> succursale) n'est PAS une depense pour le
    // groupe : aucun reglement n'est cree.
    const montantAchat = Number(donnees.montantFacture ?? 0);
    if (!pointSource && montantAchat > 0) {
      await client.query(
        `INSERT INTO pharmacie_reglements
           (commande_id, reception_id, date_reglement, montant, mode, reference, commentaire, cree_par, statut)
         VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), $4,$5,$6,$7,$8,'EN_ATTENTE')`,
        [
          id,
          receptionId,
          donnees.dateReception ?? null,
          montantAchat,
          donnees.modePaiement ?? 'ESPECES',
          donnees.numeroFacture ?? null,
          donnees.commentaire ?? null,
          acteur?.id ?? null,
        ]
      );
    }
  });

  return obtenirCommande(id);
}

/**
 * Enregistre une **demande de reglement** de facture fournisseur (versement
 * complementaire ou paiement apres la reception).
 *
 * Le montant est trace dans `pharmacie_reglements` en statut EN_ATTENTE : aucune
 * ecriture de tresorerie n'est creee ici. L'administration (DG, DGA, Comptable)
 * valide la demande (voir validerReglement) et c'est cette validation qui genere
 * la sortie SORTIE / ACHAT au grand livre.
 */
export async function enregistrerReglement(commandeId, donnees, acteur = null) {
  const commande = await exigerCommande(commandeId);
  if (['BROUILLON', 'ANNULEE'].includes(commande.statut)) {
    throw ApiError.conflict(
      'Seule une commande envoyee au fournisseur peut etre reglee.',
      'COMMANDE_NON_REGLABLE'
    );
  }

  // Fournisseur interne : transfert dans le groupe, aucun reglement attendu.
  const { rows: fournisseurRows } = await query(
    'SELECT type_fournisseur FROM pharmacie_fournisseurs WHERE id = $1',
    [commande.fournisseurId]
  );
  if (fournisseurRows[0]?.type_fournisseur === 'INTERNE') {
    throw ApiError.conflict(
      'Un fournisseur interne ne donne lieu a aucun reglement.',
      'REGLEMENT_FOURNISSEUR_INTERNE'
    );
  }

  const montant = Number(donnees.montant);
  if (!Number.isFinite(montant) || montant <= 0) {
    throw ApiError.badRequest('Le montant du reglement doit etre positif.', 'MONTANT_INVALIDE');
  }

  // Le total engage (deja paye + demandes en attente) ne peut pas depasser le
  // total TTC de la commande (tolerance au centime).
  const engage = Number(commande.montantPaye ?? 0) + Number(commande.montantEnAttente ?? 0);
  const resteAEngager = Math.max(Number(commande.totalTTC) - engage, 0);
  if (montant > resteAEngager + 0.01) {
    throw ApiError.badRequest(
      `La demande depasse le reste a payer (${resteAEngager}).`,
      'REGLEMENT_EXCEDENT',
      { resteAPayer: resteAEngager, montant }
    );
  }

  await query(
    `INSERT INTO pharmacie_reglements
       (commande_id, date_reglement, montant, mode, reference, commentaire, cree_par, statut)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3,$4,$5,$6,$7,'EN_ATTENTE')`,
    [
      commandeId,
      donnees.dateReglement ?? null,
      montant,
      donnees.mode ?? 'ESPECES',
      donnees.reference ?? null,
      donnees.commentaire ?? null,
      acteur?.id ?? null,
    ]
  );

  return obtenirCommande(commandeId);
}

/** Recupere un reglement d'une commande (404 s'il n'en fait pas partie). */
async function exigerReglement(commandeId, reglementId) {
  const { rows } = await query(
    `SELECT id, montant, mode, reference, statut
       FROM pharmacie_reglements
      WHERE id = $1 AND commande_id = $2`,
    [reglementId, commandeId]
  );
  if (!rows[0]) throw ApiError.notFound('Reglement introuvable.', 'REGLEMENT_INTROUVABLE');
  return rows[0];
}

/**
 * Valide une demande de reglement (DG, DGA, Comptable...) : c'est ici que la
 * sortie d'argent est constatee, par une ecriture SORTIE / ACHAT au grand livre
 * (lien conserve dans `transaction_id`).
 */
export async function validerReglement(commandeId, reglementId, acteur = null) {
  const commande = await exigerCommande(commandeId);
  const reglement = await exigerReglement(commandeId, reglementId);
  if (reglement.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict(
      'Seul un reglement en attente peut etre valide.',
      'REGLEMENT_NON_VALIDABLE'
    );
  }

  await transaction(async (client) => {
    const transactionId = await enregistrerFlux(
      {
        pointId: commande.pointId,
        sens: 'SORTIE',
        categorie: 'ACHAT',
        mode: reglement.mode,
        montant: Number(reglement.montant),
        libelle: `Achat fournisseur (${commande.numero})${
          reglement.reference ? ` - ${reglement.reference}` : ''
        }`,
        referenceType: 'COMMANDE',
        referenceId: commandeId,
        effectuePar: acteur?.id ?? null,
      },
      client
    );

    await client.query(
      `UPDATE pharmacie_reglements
          SET statut = 'VALIDE', valide_par = $1, valide_le = now(), transaction_id = $2
        WHERE id = $3`,
      [acteur?.id ?? null, transactionId, reglementId]
    );
  });

  return obtenirCommande(commandeId);
}

/** Rejette une demande de reglement (aucune ecriture de tresorerie). */
export async function rejeterReglement(commandeId, reglementId, donnees = {}, acteur = null) {
  const reglement = await exigerReglement(commandeId, reglementId);
  if (reglement.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict(
      'Seul un reglement en attente peut etre rejete.',
      'REGLEMENT_NON_REJETABLE'
    );
  }

  await query(
    `UPDATE pharmacie_reglements
        SET statut = 'REJETE', valide_par = $1, valide_le = now(),
            commentaire = COALESCE($2, commentaire)
      WHERE id = $3`,
    [acteur?.id ?? null, donnees.motif ?? null, reglementId]
  );

  return obtenirCommande(commandeId);
}

/**
 * Demandes de reglement en attente de validation : file d'attente de
 * l'administration. Le perimetre s'applique (un utilisateur non global ne voit
 * que les commandes de son point).
 */
export async function listerReglementsEnAttente(filtres = {}, utilisateur = null) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [`g.statut = 'EN_ATTENTE'`];
  const parametres = [];

  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    if (!perimetre.pointId) {
      return { ...reponsePaginee([], 0, { page, limite }), totaux: { montant: 0, nb: 0 } };
    }
    parametres.push(perimetre.pointId);
    conditions.push(`c.point_id = $${parametres.length}`);
  } else if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`c.point_id = $${parametres.length}`);
  }

  const clause = `WHERE ${conditions.join(' AND ')}`;

  const compteur = await query(
    `SELECT count(*)::int AS total, COALESCE(SUM(g.montant), 0) AS montant
       FROM pharmacie_reglements g
       JOIN pharmacie_commandes c ON c.id = g.commande_id
       ${clause}`,
    parametres
  );

  const { rows } = await query(
    `SELECT g.id, g.commande_id, g.date_reglement, g.montant, g.mode, g.reference, g.commentaire,
            g.cree_le,
            c.numero AS commande_numero, c.point_id,
            po.nom AS point_nom, fo.nom AS fournisseur_nom,
            (u.nom || ' ' || u.prenom) AS cree_par_nom
       FROM pharmacie_reglements g
       JOIN pharmacie_commandes c     ON c.id = g.commande_id
       JOIN pharmacie_points po       ON po.id = c.point_id
       JOIN pharmacie_fournisseurs fo ON fo.id = c.fournisseur_id
       LEFT JOIN utilisateurs u ON u.id = g.cree_par
       ${clause}
       ORDER BY g.date_reglement, g.cree_le
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
    [...parametres, limite, offset]
  );

  return {
    ...reponsePaginee(
      rows.map((ligne) => ({
        id: ligne.id,
        commandeId: ligne.commande_id,
        commandeNumero: ligne.commande_numero,
        pointId: ligne.point_id,
        pointNom: ligne.point_nom,
        fournisseurNom: ligne.fournisseur_nom,
        dateReglement: ligne.date_reglement,
        montant: Number(ligne.montant),
        mode: ligne.mode,
        reference: ligne.reference ?? null,
        commentaire: ligne.commentaire ?? null,
        creeLe: ligne.cree_le,
        creeParNom: ligne.cree_par_nom ?? null,
      })),
      compteur.rows[0].total,
      { page, limite }
    ),
    totaux: { montant: Number(compteur.rows[0].montant), nb: compteur.rows[0].total },
  };
}