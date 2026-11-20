// Service des ventes de la pharmacie.
// Une vente decremente le stock (mouvements SORTIE), calcule la marge et peut
// etre encaissee en plusieurs paiements. Une annulation remet le stock.

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';
import { enregistrerFlux } from '../../finances/ledger.service.js';
import { lireParametreBooleen } from '../../parametres/parametres.service.js';
import { consommerLotsFEFO } from '../stocks/stocks.service.js';

const SELECT_VENTE = `
  SELECT v.id, v.numero, v.point_id, v.client_id,
         c.nom AS client_nom, c.telephone AS client_contact,
         v.type_vente,
         v.ordonnance_id, v.consultation_id,
         v.total_ht, v.remise, v.total_tva, v.total_ttc, v.cout_total, v.marge,
         v.montant_recu, v.montant_rendu, v.total_paye, v.reste_a_payer, v.montant_retourne,
         v.statut, v.date_vente, v.annule_le, v.motif_annulation,
         po.nom AS point_nom,
         po.telephone AS point_telephone, po.adresse AS point_adresse, po.ville AS point_ville,
         (u.nom || ' ' || u.prenom) AS vendeur_nom
  FROM pharmacie_ventes v
  JOIN pharmacie_points po ON po.id = v.point_id
  LEFT JOIN pharmacie_clients c ON c.id = v.client_id
  LEFT JOIN utilisateurs u ON u.id = v.vendeur_id
`;

/** Transforme une ligne de vente en objet API. */
function serialiserVente(ligne) {
  if (!ligne) return null;
  const totalPaye = Number(ligne.total_paye ?? 0);
  const resteAPayer = Number(ligne.reste_a_payer ?? 0);
  return {
    id: ligne.id,
    numero: ligne.numero,
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    // Coordonnees du point de vente : reportees en tete du recu.
    pointTelephone: ligne.point_telephone ?? null,
    pointAdresse: ligne.point_adresse ?? null,
    pointVille: ligne.point_ville ?? null,
    clientId: ligne.client_id ?? null,
    clientNom: ligne.client_nom ?? null,
    clientContact: ligne.client_contact ?? null,
    typeVente: ligne.type_vente,
    // Origine clinique de la vente (ordonnance et consultation servies).
    ordonnanceId: ligne.ordonnance_id ?? null,
    consultationId: ligne.consultation_id ?? null,
    totalHT: Number(ligne.total_ht),
    remise: Number(ligne.remise),
    totalTVA: Number(ligne.total_tva),
    totalTTC: Number(ligne.total_ttc),
    coutTotal: Number(ligne.cout_total),
    marge: Number(ligne.marge),
    // Suivi d'encaissement : montant remis, monnaie rendue et creance restante.
    montantRecu: ligne.montant_recu === null || ligne.montant_recu === undefined ? null : Number(ligne.montant_recu),
    montantRendu: ligne.montant_rendu === null || ligne.montant_rendu === undefined ? null : Number(ligne.montant_rendu),
    totalPaye,
    resteAPayer,
    // Cumul TTC des produits deja retournes par le client.
    montantRetourne: Number(ligne.montant_retourne ?? 0),
    // Une vente validee sans solde complet est une vente a credit.
    statutPaiement: ligne.statut === 'ANNULEE' ? 'ANNULEE' : resteAPayer > 0 ? 'CREDIT' : 'SOLDE',
    statut: ligne.statut,
    vendeurNom: ligne.vendeur_nom ?? null,
    dateVente: ligne.date_vente,
    annuleLe: ligne.annule_le ?? null,
    motifAnnulation: ligne.motif_annulation ?? null,
  };
}

/** Transforme une ligne de detail en objet API. */
function serialiserLigneVente(ligne) {
  return {
    id: ligne.id,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    produitNom: ligne.produit_nom,
    quantite: ligne.quantite,
    prixUnitaire: Number(ligne.prix_unitaire),
    coutUnitaire: Number(ligne.cout_unitaire),
    remise: Number(ligne.remise),
    totalLigne: Number(ligne.total_ligne),
  };
}

/** Genere un numero de vente unique. */
function genererNumero(prefixe) {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  return `${prefixe}-${jour}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

/** Arrondi monetaire a deux decimales. */
const arrondi = (valeur) => Math.round(Number(valeur) * 100) / 100;

/** Liste paginee des ventes. */
export async function listerVentes(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];
  // Sens de tri chronologique (le plus recent par defaut).
  const ordre = filtres.ordre === 'ancien' ? 'ASC' : 'DESC';

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`v.point_id = $${parametres.length}`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`v.statut = $${parametres.length}`);
  }
  // Tri par etat d'encaissement : soldées (payées en totalité) ou non soldées
  // (ventes à crédit avec un reste à payer). On exclut les ventes annulées.
  if (filtres.statutPaiement === 'SOLDE') {
    conditions.push("v.statut = 'VALIDEE' AND v.reste_a_payer <= 0");
  } else if (filtres.statutPaiement === 'CREDIT') {
    conditions.push("v.statut = 'VALIDEE' AND v.reste_a_payer > 0");
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`v.date_vente >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`v.date_vente < ($${parametres.length}::date + 1)`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    conditions.push(
      `(v.numero ILIKE $${parametres.length} OR c.nom ILIKE $${parametres.length} OR c.telephone ILIKE $${parametres.length})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(
      `SELECT count(*)::int AS total
       FROM pharmacie_ventes v
       LEFT JOIN pharmacie_clients c ON c.id = v.client_id
       ${clause}`,
      parametres
    ),
    query(
      `${SELECT_VENTE} ${clause}
       ORDER BY v.date_vente ${ordre}, v.id ${ordre}
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserVente), compteur.rows[0].total, { page, limite });
}

/** Recupere une vente complete (lignes + paiements) ou null. */
export async function obtenirVente(id) {
  const { rows } = await query(`${SELECT_VENTE} WHERE v.id = $1`, [id]);
  if (!rows[0]) return null;

  const vente = serialiserVente(rows[0]);

  const [lignes, paiements, client, retours, lignesRetour] = await Promise.all([
    query(
      `SELECT l.*, pr.code AS produit_code, pr.nom_commercial AS produit_nom
       FROM pharmacie_ventes_lignes l
       JOIN pharmacie_produits pr ON pr.id = l.produit_id
       WHERE l.vente_id = $1
       ORDER BY pr.nom_commercial`,
      [id]
    ),
    query(
      `SELECT id, mode, montant, reference, date_paiement
       FROM pharmacie_paiements WHERE vente_id = $1 ORDER BY date_paiement`,
      [id]
    ),
    vente.clientId
      ? query('SELECT nom, telephone, email, adresse FROM pharmacie_clients WHERE id = $1', [vente.clientId])
      : Promise.resolve({ rows: [] }),
    // Entetes des retours deja enregistres sur cette vente.
    query(
      `SELECT rv.id, rv.numero, rv.montant_ttc, rv.montant_rembourse, rv.motif, rv.date_retour,
              (u.nom || ' ' || u.prenom) AS effectue_par_nom
       FROM pharmacie_retours_ventes rv
       LEFT JOIN utilisateurs u ON u.id = rv.effectue_par
       WHERE rv.vente_id = $1
       ORDER BY rv.date_retour`,
      [id]
    ),
    // Lignes detailees de ces retours.
    query(
      `SELECT rl.id, rl.retour_id, rl.vente_ligne_id, rl.produit_id, pr.nom_commercial AS produit_nom,
              rl.quantite, rl.prix_unitaire, rl.cout_unitaire, rl.total_ligne
       FROM pharmacie_retours_ventes_lignes rl
       JOIN pharmacie_retours_ventes rv ON rv.id = rl.retour_id
       JOIN pharmacie_produits pr ON pr.id = rl.produit_id
       WHERE rv.vente_id = $1`,
      [id]
    ),
  ]);

  vente.lignes = lignes.rows.map(serialiserLigneVente);
  vente.paiements = paiements.rows.map((ligne) => ({
    id: ligne.id,
    mode: ligne.mode,
    montant: Number(ligne.montant),
    reference: ligne.reference ?? null,
    datePaiement: ligne.date_paiement,
  }));
  vente.totalPaye = arrondi(vente.paiements.reduce((total, paiement) => total + paiement.montant, 0));
  // Le reste du tient compte des produits deja retournes.
  vente.resteAPayer = arrondi(
    Math.max(vente.totalTTC - (vente.montantRetourne ?? 0) - vente.totalPaye, 0)
  );
  if (vente.statut !== 'ANNULEE') {
    vente.statutPaiement = vente.resteAPayer > 0 ? 'CREDIT' : 'SOLDE';
  }

  // Quantites deja retournees, par ligne de vente (borne du formulaire de retour).
  const quantiteRetourneeParLigne = new Map();
  for (const ligneRetour of lignesRetour.rows) {
    if (!ligneRetour.vente_ligne_id) continue;
    quantiteRetourneeParLigne.set(
      ligneRetour.vente_ligne_id,
      (quantiteRetourneeParLigne.get(ligneRetour.vente_ligne_id) ?? 0) + Number(ligneRetour.quantite)
    );
  }
  for (const ligne of vente.lignes) {
    const retournee = quantiteRetourneeParLigne.get(ligne.id) ?? 0;
    ligne.quantiteRetournee = retournee;
    ligne.quantiteRetournable = Math.max(ligne.quantite - retournee, 0);
  }

  // Historique des retours (entetes + lignes rattachees).
  const lignesParRetour = new Map();
  for (const ligneRetour of lignesRetour.rows) {
    const liste = lignesParRetour.get(ligneRetour.retour_id) ?? [];
    liste.push({
      id: ligneRetour.id,
      venteLigneId: ligneRetour.vente_ligne_id ?? null,
      produitId: ligneRetour.produit_id,
      produitNom: ligneRetour.produit_nom,
      quantite: Number(ligneRetour.quantite),
      prixUnitaire: Number(ligneRetour.prix_unitaire),
      coutUnitaire: Number(ligneRetour.cout_unitaire),
      totalLigne: Number(ligneRetour.total_ligne),
    });
    lignesParRetour.set(ligneRetour.retour_id, liste);
  }
  vente.retours = retours.rows.map((ligne) => ({
    id: ligne.id,
    numero: ligne.numero,
    venteId: id,
    montantTTC: Number(ligne.montant_ttc),
    montantRembourse: Number(ligne.montant_rembourse),
    motif: ligne.motif ?? null,
    effectueParNom: ligne.effectue_par_nom ?? null,
    dateRetour: ligne.date_retour,
    lignes: lignesParRetour.get(ligne.id) ?? [],
  }));
  // Informations completes du client (si la vente est rattachee a un client).
  vente.client = client.rows[0]
    ? {
        nom: client.rows[0].nom,
        telephone: client.rows[0].telephone ?? null,
        email: client.rows[0].email ?? null,
        adresse: client.rows[0].adresse ?? null,
      }
    : null;
  return vente;
}

/** Recupere une vente ou leve une 404. */
export async function exigerVente(id) {
  const vente = await obtenirVente(id);
  if (!vente) throw ApiError.notFound('Vente introuvable.', 'VENTE_INTROUVABLE');
  return vente;
}

/** Verifie qu'un compte de paiement peut etre utilise pour cette pharmacie. */
async function verifierComptePaiement(compteId, pointId, executer) {
  if (!compteId) return;
  const { rows } = await executer('SELECT point_id, actif FROM finance_comptes WHERE id = $1', [
    compteId,
  ]);
  const compte = rows[0];
  if (!compte) {
    throw ApiError.badRequest('Compte de paiement introuvable.', 'COMPTE_INTROUVABLE');
  }
  if (!compte.actif) {
    throw ApiError.badRequest('Ce compte de paiement est desactive.', 'COMPTE_INACTIF');
  }
  if (compte.point_id && String(compte.point_id) !== String(pointId)) {
    throw ApiError.forbidden(
      "Ce compte de paiement n'appartient pas a cette pharmacie.",
      'HORS_PERIMETRE'
    );
  }
}

/** Cree une vente : valorise les lignes, verifie le stock, ecrit les sorties. */
export async function creerVente(donnees, acteur = null) {
  const id = await transaction(async (client) => {
    let totalHT = 0;
    let totalTVA = 0;
    let coutTotal = 0;
    const lignesPreparees = [];

    for (const ligne of donnees.lignes) {
      const { rows } = await client.query(
        `SELECT pp.prix_vente, pp.prix_achat_reference, pr.tva_taux, pr.gere_lot
         FROM pharmacie_produits_points pp
         JOIN pharmacie_produits pr ON pr.id = pp.produit_id
         WHERE pp.produit_id = $1 AND pp.point_id = $2`,
        [ligne.produitId, donnees.pointId]
      );
      const parametre = rows[0];
      if (!parametre) {
        throw ApiError.conflict('Produit non parametre pour ce point de vente.', 'PRODUIT_NON_PARAMETRE');
      }

      const prixUnitaire = ligne.prixUnitaire ?? Number(parametre.prix_vente);
      const coutUnitaire = Number(parametre.prix_achat_reference);
      const remise = ligne.remise ?? 0;
      const totalLigne = arrondi(ligne.quantite * prixUnitaire - remise);

      totalHT = arrondi(totalHT + totalLigne);
      totalTVA = arrondi(totalTVA + (totalLigne * Number(parametre.tva_taux)) / 100);
      coutTotal = arrondi(coutTotal + coutUnitaire * ligne.quantite);

      lignesPreparees.push({
        ...ligne,
        prixUnitaire,
        coutUnitaire,
        remise,
        totalLigne,
        gereLot: Boolean(parametre.gere_lot),
      });
    }

    const remiseGlobale = donnees.remise ?? 0;
    const totalTTC = arrondi(totalHT + totalTVA - remiseGlobale);
    const marge = arrondi(totalHT - remiseGlobale - coutTotal);

    // Verification du stock par produit (cumul des quantites demandees)
    const demandes = new Map();
    for (const ligne of lignesPreparees) {
      demandes.set(ligne.produitId, (demandes.get(ligne.produitId) ?? 0) + ligne.quantite);
    }
    for (const [produitId, quantite] of demandes) {
      const dispo = await client.query(
        'SELECT COALESCE(quantite, 0) AS quantite FROM v_pharmacie_stock WHERE point_id = $1 AND produit_id = $2',
        [donnees.pointId, produitId]
      );
      const disponible = dispo.rows[0]?.quantite ?? 0;
      if (disponible < quantite) {
        throw ApiError.conflict('Stock insuffisant pour un produit de la vente.', 'STOCK_INSUFFISANT', {
          produitId,
          disponible,
          demande: quantite,
        });
      }
    }

    // Resolution du client : la vente ne stocke AUCUNE information client en
    // propre (pas de redondance) : elle pointe vers la fiche `pharmacie_clients`
    // via `client_id`. Deux cas sont geres :
    //   * client existant selectionne (clientId) -> rattachement direct ;
    //   * nouveau client (client { nom, ... }) -> recherche d'un doublon evident
    //     (meme nom + meme telephone, actif, meme pharmacie ou global), puis
    //     creation si aucun ne correspond, avant rattachement.
    // Aucun client : vente au comptoir anonyme (client_id reste NULL).
    let clientId = donnees.clientId ?? null;
    let clientNom = null;
    let clientContact = null;

    if (clientId) {
      // Le client doit appartenir a la pharmacie de la vente (ou etre global).
      const existant = await client.query(
        'SELECT nom, telephone FROM pharmacie_clients WHERE id = $1 AND (point_id IS NULL OR point_id = $2)',
        [clientId, donnees.pointId]
      );
      if (existant.rowCount === 0) throw ApiError.notFound('Client introuvable.', 'CLIENT_INTROUVABLE');
      clientNom = existant.rows[0].nom;
      clientContact = existant.rows[0].telephone;
    } else if (donnees.client?.nom) {
      const nom = donnees.client.nom.trim();
      const telephone = donnees.client.telephone?.trim() || null;

      // Anti-doublon prudent : meme nom ET meme telephone deja enregistres.
      let existant = null;
      if (telephone) {
        const recherche = await client.query(
          `SELECT id, nom, telephone FROM pharmacie_clients
           WHERE actif = TRUE
             AND (point_id IS NULL OR point_id = $1)
             AND telephone = $2
             AND lower(nom) = lower($3)
           ORDER BY (point_id IS NOT NULL) DESC, created_at ASC
           LIMIT 1`,
          [donnees.pointId, telephone, nom]
        );
        existant = recherche.rows[0] ?? null;
      }

      if (existant) {
        clientId = existant.id;
        clientNom = existant.nom;
        clientContact = existant.telephone;
      } else {
        const cree = await client.query(
          `INSERT INTO pharmacie_clients (nom, telephone, email, adresse, point_id)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, nom, telephone`,
          [nom, telephone, donnees.client.email || null, donnees.client.adresse || null, donnees.pointId ?? null]
        );
        clientId = cree.rows[0].id;
        clientNom = cree.rows[0].nom;
        clientContact = cree.rows[0].telephone;
      }
    }

    // ---------------------------------------------------------------------
    // Encaissement : le client peut ne pas payer la totalite (vente a credit).
    // ---------------------------------------------------------------------
    const paiement = donnees.paiement ?? {};
    await verifierComptePaiement(paiement.compteId, donnees.pointId, (texte, parametres) =>
      client.query(texte, parametres)
    );
    const montantDemande = paiement.montant ?? totalTTC;
    const montantPaye = arrondi(Math.min(Math.max(Number(montantDemande) || 0, 0), totalTTC));
    // Tolerance d'arrondi : un ecart inferieur au centime n'est pas un credit.
    const resteBrut = arrondi(totalTTC - montantPaye);
    const resteAPayer = resteBrut <= 0.01 ? 0 : resteBrut;

    // Montant remis par le client (sert a calculer la monnaie a rendre).
    const montantRecu =
      donnees.montantRecu === undefined || donnees.montantRecu === null
        ? montantPaye
        : arrondi(Math.max(Number(donnees.montantRecu) || 0, 0));

    if (montantRecu < montantPaye) {
      throw ApiError.badRequest(
        'Le montant recu est inferieur au montant encaisse.',
        'MONTANT_RECU_INSUFFISANT',
        { montantRecu, montantPaye }
      );
    }
    const montantRendu = arrondi(Math.max(montantRecu - montantPaye, 0));

    // Une vente a credit exige un client identifie : nom + telephone.
    if (resteAPayer > 0) {
      if (!clientNom || !String(clientNom).trim()) {
        throw ApiError.badRequest(
          'Une vente a credit doit etre rattachee a un client identifie (nom et telephone).',
          'CLIENT_REQUIS_POUR_CREDIT'
        );
      }
      if (!clientContact || !String(clientContact).trim()) {
        throw ApiError.badRequest(
          'Le numero de telephone du client est obligatoire pour une vente a credit.',
          'TELEPHONE_CLIENT_REQUIS',
          { clientNom }
        );
      }
    }

    const vente = await client.query(
      `INSERT INTO pharmacie_ventes
         (numero, point_id, client_id, type_vente, total_ht, remise,
          total_tva, total_ttc, cout_total, marge, montant_recu, montant_rendu, total_paye,
          reste_a_payer, vendeur_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        genererNumero('VTE'),
        donnees.pointId,
        clientId,
        donnees.typeVente ?? 'COMPTOIR',
        totalHT,
        remiseGlobale,
        totalTVA,
        totalTTC,
        coutTotal,
        marge,
        montantRecu,
        montantRendu,
        montantPaye,
        resteAPayer,
        acteur?.id ?? null,
      ]
    );
    const venteId = vente.rows[0].id;

    // Ordonnance de la clinique (facultatif) : la vente sert la prescription.
    // Le lien est conservé sur la vente (ordonnance + consultation d'origine)
    // et l'ordonnance passe à « SERVIE » : la traçabilité remonte du ticket de
    // caisse jusqu'au diagnostic de l'animal.
    if (donnees.ordonnanceId) {
      const ordonnance = await client.query(
        'SELECT id, statut, consultation_id, approuve_le FROM clinique_ordonnances WHERE id = $1',
        [donnees.ordonnanceId]
      );
      if (ordonnance.rowCount === 0) {
        throw ApiError.notFound('Ordonnance introuvable.', 'ORDONNANCE_INTROUVABLE');
      }
      if (ordonnance.rows[0].statut === 'ANNULEE') {
        throw ApiError.conflict('Cette ordonnance est annulee.', 'ORDONNANCE_ANNULEE');
      }
      // Une proposition non approuvee ne peut pas etre vendue : le Docteur
      // veterinaire doit d'abord approuver la prescription.
      if (!ordonnance.rows[0].approuve_le) {
        throw ApiError.conflict(
          'Cette ordonnance est encore une proposition : approbation du Docteur veterinaire requise.',
          'ORDONNANCE_NON_APPROUVEE'
        );
      }

      await client.query(
        `UPDATE pharmacie_ventes
         SET ordonnance_id = $2, consultation_id = $3
         WHERE id = $1`,
        [venteId, donnees.ordonnanceId, ordonnance.rows[0].consultation_id ?? null]
      );
      await client.query(
        `UPDATE clinique_ordonnances
         SET statut = 'SERVIE', delivre_le = COALESCE(delivre_le, now())
         WHERE id = $1`,
        [donnees.ordonnanceId]
      );
      await client.query(
        'UPDATE clinique_ordonnances_lignes SET vendu = TRUE WHERE ordonnance_id = $1',
        [donnees.ordonnanceId]
      );
    }

    for (const ligne of lignesPreparees) {
      await client.query(
        `INSERT INTO pharmacie_ventes_lignes
           (vente_id, produit_id, lot_id, quantite, prix_unitaire, cout_unitaire, remise, total_ligne)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          venteId,
          ligne.produitId,
          ligne.lotId ?? null,
          ligne.quantite,
          ligne.prixUnitaire,
          ligne.coutUnitaire,
          ligne.remise,
          ligne.totalLigne,
        ]
      );

      if (ligne.gereLot) {
        // Produit suivi par lot : sortie FEFO (un mouvement par lot consomme,
        // les peremptions les plus proches en premier).
        await consommerLotsFEFO(
          client,
          {
            pointId: donnees.pointId,
            produitId: ligne.produitId,
            typeMouvement: 'SORTIE',
            quantite: ligne.quantite,
            prixUnitaire: ligne.coutUnitaire,
            motif: 'Vente',
            referenceType: 'VENTE',
            referenceId: venteId,
          },
          acteur
        );
      } else {
        await client.query(
          `INSERT INTO pharmacie_mouvements_stock
             (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
              reference_type, reference_id, utilisateur_id)
           VALUES ($1,$2,$3,'SORTIE',$4,$5,'Vente','VENTE',$6,$7)`,
          [donnees.pointId, ligne.produitId, ligne.lotId ?? null, ligne.quantite, ligne.coutUnitaire, venteId, acteur?.id ?? null]
        );
      }
    }

    // Paiement : montant fourni (eventuellement partiel), sinon la totalite.
    if (montantPaye > 0) {
      await client.query(
        `INSERT INTO pharmacie_paiements (vente_id, mode, montant, reference, encaisse_par)
         VALUES ($1,$2,$3,$4,$5)`,
        [venteId, paiement.mode ?? 'ESPECES', montantPaye, paiement.reference ?? null, acteur?.id ?? null]
      );

      // Base financière unique : l'encaissement de la vente alimente le grand livre.
      await enregistrerFlux(
        {
          pointId: donnees.pointId,
          compteId: paiement.compteId ?? null,
          sens: 'ENTREE',
          categorie: 'VENTE',
          mode: paiement.mode ?? 'ESPECES',
          montant: montantPaye,
          libelle:
            resteAPayer > 0
              ? `Vente a credit (${donnees.typeVente ?? 'COMPTOIR'}) - acompte`
              : `Vente comptoir (${donnees.typeVente ?? 'COMPTOIR'})`,
          referenceType: 'VENTE',
          referenceId: venteId,
          effectuePar: acteur?.id ?? null,
        },
        client
      );
    }

    return venteId;
  });

  return obtenirVente(id);
}

/** Annule une vente et remet les quantites en stock (mouvements RETOUR). */
export async function annulerVente(id, motif, acteur = null) {
  const vente = await exigerVente(id);
  if (vente.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette vente est deja annulee.', 'VENTE_DEJA_ANNULEE');
  }

  await transaction(async (client) => {
    for (const ligne of vente.lignes) {
      await client.query(
        `INSERT INTO pharmacie_mouvements_stock
           (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
            reference_type, reference_id, utilisateur_id)
         VALUES ($1,$2,$3,'RETOUR',$4,$5,$6,'ANNULATION_VENTE',$7,$8)`,
        [vente.pointId, ligne.produitId, null, ligne.quantite, ligne.coutUnitaire, motif, id, acteur?.id ?? null]
      );
    }
    await client.query(
      `UPDATE pharmacie_ventes SET statut = 'ANNULEE', annule_le = now(), motif_annulation = $1 WHERE id = $2`,
      [motif, id]
    );

    // Contre-écriture au grand livre : sortie du montant déjà encaissé.
    if (Number(vente.totalPaye ?? 0) > 0) {
      await enregistrerFlux(
        {
          pointId: vente.pointId,
          sens: 'SORTIE',
          categorie: 'REMBOURSEMENT',
          mode: 'ESPECES',
          montant: Number(vente.totalPaye),
          libelle: `Annulation vente ${vente.numero}`,
          referenceType: 'VENTE',
          referenceId: id,
          effectuePar: acteur?.id ?? null,
        },
        client
      );
    }
  });

  return obtenirVente(id);
}

/** Ajoute un encaissement complementaire a une vente validee. */
export async function ajouterPaiement(venteId, donnees, acteur = null) {
  const vente = await exigerVente(venteId);
  if (vente.statut !== 'VALIDEE') {
    throw ApiError.conflict("Impossible d'encaisser une vente annulee.", 'VENTE_ANNULEE');
  }

  // Le complement ne peut pas depasser la creance restante.
  const reste = Number(vente.resteAPayer ?? 0);
  if (reste <= 0) {
    throw ApiError.conflict('Cette vente est deja entierement payee.', 'VENTE_SOLDEE');
  }
  if (Number(donnees.montant) > reste) {
    throw ApiError.badRequest('Le montant depasse le reste a payer.', 'MONTANT_SUPERIEUR_AU_RESTE', {
      resteAPayer: reste,
    });
  }

  await verifierComptePaiement(donnees.compteId, vente.pointId, query);

  await query(
    `INSERT INTO pharmacie_paiements (vente_id, mode, montant, reference, encaisse_par)
     VALUES ($1,$2,$3,$4,$5)`,
    [venteId, donnees.mode ?? 'ESPECES', donnees.montant, donnees.reference ?? null, acteur?.id ?? null]
  );

  // Base financière unique : l'encaissement alimente le grand livre.
  await enregistrerFlux({
    pointId: vente.pointId,
    compteId: donnees.compteId ?? null,
    sens: 'ENTREE',
    categorie: 'VENTE',
    mode: donnees.mode ?? 'ESPECES',
    montant: donnees.montant,
    libelle: `Encaissement vente ${vente.numero}`,
    referenceType: 'VENTE',
    referenceId: venteId,
    effectuePar: acteur?.id ?? null,
  });

  return obtenirVente(venteId);
}

/**
 * Rapport « produits vendus » : agregation des lignes de vente sur une periode,
 * avec recherche par produit. Donne les quantites, le chiffre d'affaires et la
 * marge par produit vendu.
 */
export async function listerProduitsVendus(filtres = {}) {
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
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(pr.nom_commercial ILIKE $${i} OR pr.code ILIKE $${i} OR pr.dci ILIKE $${i})`);
  }

  const clause = `WHERE ${conditions.join(' AND ')}`;
  const tri = filtres.ordre === 'quantite' ? 'quantite DESC' : 'chiffre_affaires DESC';

  const { rows } = await query(
    `SELECT pr.id AS produit_id, pr.code, pr.nom_commercial, pr.categorie, pr.unite_mesure,
            SUM(l.quantite)::int AS quantite,
            count(DISTINCT v.id)::int AS nb_ventes,
            SUM(l.total_ligne) AS chiffre_affaires,
            SUM(l.total_ligne - l.cout_unitaire * l.quantite) AS marge
     FROM pharmacie_ventes_lignes l
     JOIN pharmacie_ventes v ON v.id = l.vente_id
     JOIN pharmacie_produits pr ON pr.id = l.produit_id
     ${clause}
     GROUP BY pr.id
     ORDER BY ${tri}
     LIMIT 500`,
    parametres
  );

  return rows.map((ligne) => ({
    produitId: ligne.produit_id,
    code: ligne.code,
    nomCommercial: ligne.nom_commercial,
    categorie: ligne.categorie,
    uniteMesure: ligne.unite_mesure,
    quantite: ligne.quantite,
    nbVentes: ligne.nb_ventes,
    chiffreAffaires: Number(ligne.chiffre_affaires ?? 0),
    marge: Number(ligne.marge ?? 0),
  }));
}

/**
 * Enregistre un retour de produits sur une vente validee (retour total ou
 * partiel, eventuellement repete). Pour chaque ligne retournee :
 *   - remise en stock (mouvement RETOUR, reference RETOUR_VENTE) ;
 *   - valorisation HT proportionnelle a la quantite retournee.
 * La vente est mise a jour : cumul `montant_retourne` et `reste_a_payer`
 * recalcule. Le trop-percu est rembourse en especes si le remboursement est
 * autorise par les parametres ; sinon le retour est refuse des qu'il genererait
 * un remboursement (seule la creance d'une vente a credit peut etre reduite).
 */
export async function creerRetourVente(venteId, donnees, acteur = null) {
  const vente = await exigerVente(venteId);
  if (vente.statut !== 'VALIDEE') {
    throw ApiError.conflict("Une vente annulee ne peut pas faire l'objet d'un retour.", 'VENTE_ANNULEE');
  }

  // Parametres globaux (administrables par la Direction / le Comptable).
  const retoursActifs = await lireParametreBooleen('pharmacie.retours.actif', true);
  if (!retoursActifs) {
    throw ApiError.conflict('La gestion des retours de vente est desactivee.', 'RETOURS_DESACTIVES');
  }
  const remboursementActif = await lireParametreBooleen('pharmacie.retours.remboursement.actif', true);

  // Quantites deja retournees, par ligne de vente.
  const { rows: dejaRows } = await query(
    `SELECT rl.vente_ligne_id, SUM(rl.quantite)::int AS quantite
     FROM pharmacie_retours_ventes_lignes rl
     JOIN pharmacie_retours_ventes rv ON rv.id = rl.retour_id
     WHERE rv.vente_id = $1
     GROUP BY rl.vente_ligne_id`,
    [venteId]
  );
  const dejaRetourne = new Map(dejaRows.map((ligne) => [ligne.vente_ligne_id, Number(ligne.quantite)]));

  // Preparation des lignes : controle du restant et valorisation HT.
  const lignesPreparees = [];
  let valeurHTRetour = 0;
  for (const demande of donnees.lignes) {
    const ligneVente = vente.lignes.find((ligne) => ligne.id === demande.ligneId);
    if (!ligneVente) {
      throw ApiError.badRequest('Ligne de vente introuvable dans cette vente.', 'LIGNE_VENTE_INTROUVABLE', {
        ligneId: demande.ligneId,
      });
    }
    const restante = ligneVente.quantite - (dejaRetourne.get(ligneVente.id) ?? 0);
    if (demande.quantite > restante) {
      throw ApiError.badRequest(
        `Quantite retournee superieure au restant disponible (${restante}).`,
        'QUANTITE_RETOUR_EXCEDEE',
        { ligneId: ligneVente.id, restante, demandee: demande.quantite }
      );
    }
    const totalLigneHT = arrondi((ligneVente.totalLigne * demande.quantite) / ligneVente.quantite);
    valeurHTRetour = arrondi(valeurHTRetour + totalLigneHT);
    lignesPreparees.push({ ...ligneVente, quantiteRetour: demande.quantite, totalLigneHT });
  }

  // Valeur TTC du retour : part du TTC de la vente (remise globale repartie).
  const montantTTCRetour =
    vente.totalHT > 0 ? arrondi((valeurHTRetour * vente.totalTTC) / vente.totalHT) : valeurHTRetour;

  const nouveauMontantRetourne = Math.min(
    arrondi((vente.montantRetourne ?? 0) + montantTTCRetour),
    vente.totalTTC
  );
  const nouveauNet = arrondi(vente.totalTTC - nouveauMontantRetourne);
  const totalPaye = arrondi(vente.totalPaye ?? 0);
  const tropPercu = arrondi(Math.max(totalPaye - nouveauNet, 0));

  if (!remboursementActif && tropPercu > 0.01) {
    throw ApiError.conflict(
      'Le remboursement des retours est desactive : ce retour genererait un remboursement.',
      'REMBOURSEMENT_DESACTIVE',
      { tropPercu }
    );
  }
  const montantRembourse = remboursementActif ? tropPercu : 0;

  const retourId = await transaction(async (client) => {
    // Entete du retour.
    const entete = await client.query(
      `INSERT INTO pharmacie_retours_ventes
         (numero, vente_id, point_id, client_id, montant_ttc, montant_rembourse, motif, effectue_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        genererNumero('RTV'),
        venteId,
        vente.pointId,
        vente.clientId ?? null,
        montantTTCRetour,
        montantRembourse,
        donnees.motif ?? null,
        acteur?.id ?? null,
      ]
    );
    const id = entete.rows[0].id;

    for (const ligne of lignesPreparees) {
      // Ligne du retour (valeur HT).
      await client.query(
        `INSERT INTO pharmacie_retours_ventes_lignes
           (retour_id, vente_ligne_id, produit_id, quantite, prix_unitaire, cout_unitaire, total_ligne)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          ligne.id,
          ligne.produitId,
          ligne.quantiteRetour,
          ligne.prixUnitaire,
          ligne.coutUnitaire,
          ligne.totalLigneHT,
        ]
      );

      // Remise en stock : mouvement RETOUR rattache au retour.
      await client.query(
        `INSERT INTO pharmacie_mouvements_stock
           (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
            reference_type, reference_id, utilisateur_id)
         VALUES ($1,$2,$3,'RETOUR',$4,$5,$6,'RETOUR_VENTE',$7,$8)`,
        [
          vente.pointId,
          ligne.produitId,
          null,
          ligne.quantiteRetour,
          ligne.coutUnitaire,
          donnees.motif ?? 'Retour client',
          id,
          acteur?.id ?? null,
        ]
      );
    }

    // Mise a jour de la vente : cumul retourne + creance recalculee.
    await client.query(
      `UPDATE pharmacie_ventes
       SET montant_retourne = $1,
           reste_a_payer = GREATEST(total_ttc - $1 - total_paye, 0)
       WHERE id = $2`,
      [nouveauMontantRetourne, venteId]
    );

    // Remboursement en especes du trop-percu (si autorise et necessaire).
    if (montantRembourse > 0) {
      await enregistrerFlux(
        {
          pointId: vente.pointId,
          sens: 'SORTIE',
          categorie: 'REMBOURSEMENT',
          mode: 'ESPECES',
          montant: montantRembourse,
          libelle: `Retour vente ${vente.numero}`,
          referenceType: 'RETOUR_VENTE',
          referenceId: id,
          effectuePar: acteur?.id ?? null,
        },
        client
      );
    }

    return id;
  });

  return obtenirVente(venteId);
}