
// Service du module Finance (transversal).
// Gère le registre des services, le grand livre unique (transactions) et les
// dépenses. Toutes les écritures restent centralisées, mais l'affichage est
// filtré selon le périmètre de l'utilisateur (une pharmacie ou tout le groupe).

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../utils/pagination.js';
import { perimetreUtilisateur, resoudrePointId } from '../../utils/perimetre.js';
import { enregistrerFlux } from './ledger.service.js';

const nombre = (valeur) => Number(valeur ?? 0);

/** Génère un numéro unique (préfixe + date + suffixe aléatoire). */
function genererNumero(prefixe) {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  return `${prefixe}-${jour}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

// -----------------------------------------------------------------------------
// Services (centres de flux)
// -----------------------------------------------------------------------------

function serialiserService(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    typeService: ligne.type_service,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    departementId: ligne.departement_id ?? null,
    departementNom: ligne.departement_nom ?? null,
    description: ligne.description ?? null,
    actif: Boolean(ligne.actif),
  };
}

/** Liste les services financiers (pharmacies et activités). */
export async function listerServices(filtres = {}, utilisateur = null) {
  const conditions = [];
  const parametres = [];

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    conditions.push(`(s.nom ILIKE $${parametres.length} OR s.code ILIKE $${parametres.length})`);
  }
  if (filtres.typeService) {
    parametres.push(filtres.typeService);
    conditions.push(`s.type_service = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`s.actif = $${parametres.length}`);
  }

  // Périmètre : un compte non global ne voit que le service de sa pharmacie
  // (et n'a aucun accès s'il n'est rattaché à aucune pharmacie).
  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    const pointImpose = resoudrePointId(utilisateur, null);
    parametres.push(pointImpose);
    conditions.push(`s.point_id = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT s.id, s.code, s.nom, s.type_service, s.point_id, s.departement_id,
            s.description, s.actif,
            po.nom AS point_nom, d.nom AS departement_nom
     FROM finance_services s
     LEFT JOIN pharmacie_points po ON po.id = s.point_id
     LEFT JOIN departements d ON d.id = s.departement_id
     ${clause}
     ORDER BY CASE s.type_service WHEN 'PHARMACIE' THEN 0 ELSE 1 END, s.nom`,
    parametres
  );
  return rows.map(serialiserService);
}

/** Récupère un service ou null. */
export async function obtenirService(id) {
  const { rows } = await query(
    `SELECT s.id, s.code, s.nom, s.type_service, s.point_id, s.departement_id,
            s.description, s.actif, po.nom AS point_nom, d.nom AS departement_nom
     FROM finance_services s
     LEFT JOIN pharmacie_points po ON po.id = s.point_id
     LEFT JOIN departements d ON d.id = s.departement_id
     WHERE s.id = $1`,
    [id]
  );
  return rows[0] ? serialiserService(rows[0]) : null;
}

// -----------------------------------------------------------------------------
// Grand livre (transactions)
// -----------------------------------------------------------------------------

function serialiserTransaction(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    numero: ligne.numero,
    serviceId: ligne.service_id,
    serviceNom: ligne.service_nom,
    typeService: ligne.type_service,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    compteId: ligne.compte_id ?? null,
    compteType: ligne.compte_type ?? null,
    comptePrestataire: ligne.compte_prestataire ?? null,
    compteLibelle: ligne.compte_libelle ?? null,
    compteNumero: ligne.compte_numero ?? null,
    sens: ligne.sens,
    categorie: ligne.categorie,
    mode: ligne.mode,
    montant: nombre(ligne.montant),
    libelle: ligne.libelle ?? null,
    referenceType: ligne.reference_type ?? null,
    referenceId: ligne.reference_id ?? null,
    effectueParNom: ligne.effectue_par_nom ?? null,
    dateTransaction: ligne.date_transaction,
  };
}

const SELECT_TRANSACTION = `
  SELECT t.id, t.numero, t.service_id, t.point_id, t.compte_id, t.sens, t.categorie, t.mode,
         t.montant, t.libelle, t.reference_type, t.reference_id, t.date_transaction,
         s.nom AS service_nom, s.type_service, po.nom AS point_nom,
         c.type AS compte_type, c.prestataire AS compte_prestataire,
         c.libelle AS compte_libelle, c.numero AS compte_numero,
         (u.nom || ' ' || u.prenom) AS effectue_par_nom
  FROM finance_transactions t
  JOIN finance_services s ON s.id = t.service_id
  LEFT JOIN pharmacie_points po ON po.id = t.point_id
  LEFT JOIN finance_comptes c ON c.id = t.compte_id
  LEFT JOIN utilisateurs u ON u.id = t.effectue_par
`;

/** Construit les conditions de filtrage du grand livre. */
function conditionsTransactions(filtres, utilisateur, parametres) {
  const conditions = [];
  const perimetre = perimetreUtilisateur(utilisateur);
  const pointId = resoudrePointId(utilisateur, filtres.pointId);

  if (pointId) {
    parametres.push(pointId);
    conditions.push(`t.point_id = $${parametres.length}`);
  } else if (!perimetre.global) {
    // Compte non global sans pharmacie : aucune donnée visible.
    conditions.push('FALSE');
  }
  if (filtres.serviceId) {
    parametres.push(filtres.serviceId);
    conditions.push(`t.service_id = $${parametres.length}`);
  }
  if (filtres.compteId) {
    parametres.push(filtres.compteId);
    conditions.push(`t.compte_id = $${parametres.length}`);
  }
  if (filtres.origine === 'HORS_OPERATION') {
    // Entrées qui ne proviennent ni des ventes, ni des prestations.
    conditions.push("t.categorie IN ('FONDS_DEPART','APPORT','AUTRE')");
  } else if (filtres.origine === 'OPERATIONNELLE') {
    conditions.push("t.categorie NOT IN ('FONDS_DEPART','APPORT','AUTRE')");
  }
  if (filtres.sens) {
    parametres.push(filtres.sens);
    conditions.push(`t.sens = $${parametres.length}`);
  }
  if (filtres.categorie) {
    parametres.push(filtres.categorie);
    conditions.push(`t.categorie = $${parametres.length}`);
  }
  if (filtres.mode) {
    parametres.push(filtres.mode);
    conditions.push(`t.mode = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`t.date_transaction >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`t.date_transaction < ($${parametres.length}::date + 1)`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    conditions.push(`(t.libelle ILIKE $${parametres.length} OR t.numero ILIKE $${parametres.length})`);
  }
  return conditions;
}

/** Liste paginée des écritures du grand livre. */
export async function listerTransactions(filtres = {}, utilisateur = null) {
  const { page, limite, offset } = lirePagination(filtres);
  const parametres = [];
  const conditions = conditionsTransactions(filtres, utilisateur, parametres);
  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
              COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties
       FROM finance_transactions t ${clause}`,
      parametres
    ),
    query(
      `${SELECT_TRANSACTION} ${clause}
       ORDER BY t.date_transaction DESC, t.id DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return {
    ...reponsePaginee(liste.rows.map(serialiserTransaction), compteur.rows[0].total, { page, limite }),
    totaux: {
      entrees: nombre(compteur.rows[0].entrees),
      sorties: nombre(compteur.rows[0].sorties),
      solde: nombre(compteur.rows[0].entrees) - nombre(compteur.rows[0].sorties),
    },
  };
}

/** Vérifie qu'un compte de paiement peut être mouvementé (périmètre et cohérence). */
async function verifierCompteMouvement(compteId, mode, perimetre) {
  const { rows } = await query(
    `SELECT id, type, actif, point_id, prestataire, numero, libelle
     FROM finance_comptes WHERE id = $1`,
    [compteId]
  );
  const compte = rows[0];
  if (!compte) {
    throw ApiError.notFound('Compte de paiement introuvable.', 'COMPTE_INTROUVABLE');
  }
  if (!compte.actif) {
    throw ApiError.badRequest('Ce compte de paiement est désactivé.', 'COMPTE_INACTIF');
  }
  if (
    !perimetre.global &&
    compte.point_id &&
    String(compte.point_id) !== String(perimetre.pointId)
  ) {
    throw ApiError.forbidden(
      "Ce compte de paiement n'appartient pas à votre pharmacie.",
      'HORS_PERIMETRE'
    );
  }
  if (compte.type === 'MOBILE_MONEY' && mode !== 'MOBILE_MONEY') {
    throw ApiError.badRequest(
      'Un compte mobile money exige le moyen de paiement « Mobile money ».',
      'MODE_COMPTE_INCOHERENT'
    );
  }
  if (compte.type === 'BANQUE' && !['VIREMENT', 'CHEQUE', 'CARTE'].includes(mode)) {
    throw ApiError.badRequest(
      'Un compte bancaire exige un virement, un chèque ou une carte.',
      'MODE_COMPTE_INCOHERENT'
    );
  }
  return compte;
}

/** Saisit une écriture manuelle au grand livre (fonds de départ, apport, autre...). */
export async function creerTransaction(donnees, acteur = null) {
  const perimetre = perimetreUtilisateur(acteur);
  let pointId = perimetre.global ? donnees.pointId ?? null : perimetre.pointId;
  let serviceId = perimetre.global ? donnees.serviceId ?? null : null;
  const mode = donnees.mode ?? 'ESPECES';
  const compteId = donnees.compteId ?? null;

  if (!perimetre.global && !pointId) {
    throw ApiError.forbidden("Aucune pharmacie n'est rattachée à votre compte.", 'HORS_PERIMETRE');
  }

  if (compteId) {
    const compte = await verifierCompteMouvement(compteId, mode, perimetre);
    // Compte rattaché à une pharmacie : elle est déduite si elle n'est pas fournie.
    if (!pointId && compte.point_id) pointId = compte.point_id;
  }

  // Ni service ni pharmacie (ex. apport sur un compte du groupe) : le flux est
  // rattaché au service « Finance groupe » pour rester dans le grand livre.
  if (!serviceId && !pointId) {
    const { rows } = await query('SELECT fn_finance_service_groupe() AS id');
    serviceId = rows[0]?.id ?? null;
  }

  const id = await transaction(async (client) =>
    enregistrerFlux(
      {
        serviceId,
        pointId,
        compteId,
        sens: donnees.sens,
        categorie: donnees.categorie,
        mode,
        montant: donnees.montant,
        libelle: donnees.libelle ?? null,
        referenceType: donnees.referenceType ?? 'SAISIE',
        referenceId: donnees.referenceId ?? null,
        effectuePar: acteur?.id ?? null,
        dateTransaction: donnees.dateTransaction ?? null,
      },
      client
    )
  );

  const { rows } = await query(`${SELECT_TRANSACTION} WHERE t.id = $1`, [id]);
  return serialiserTransaction(rows[0]);
}

// -----------------------------------------------------------------------------
// Indicateurs (synthèse globale et par service / type / mode)
// -----------------------------------------------------------------------------

function conditionsIndicateurs(filtres, utilisateur, parametres) {
  const conditions = [];
  const perimetre = perimetreUtilisateur(utilisateur);
  const pointId = resoudrePointId(utilisateur, filtres.pointId);

  if (pointId) {
    parametres.push(pointId);
    conditions.push(`t.point_id = $${parametres.length}`);
  } else if (!perimetre.global) {
    conditions.push('FALSE');
  }
  if (filtres.serviceId) {
    parametres.push(filtres.serviceId);
    conditions.push(`t.service_id = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`t.date_transaction >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`t.date_transaction < ($${parametres.length}::date + 1)`);
  }
  return conditions;
}

/** Indicateurs financiers consolidés (groupe ou pharmacie). */
export async function indicateurs(filtres = {}, utilisateur = null) {
  const parametres = [];
  const conditions = conditionsIndicateurs(filtres, utilisateur, parametres);
  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [synthese, parService, parType, parCategorie, parMode, serie] = await Promise.all([
    query(
      `SELECT count(*)::int AS nb,
              COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
              COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties
       FROM finance_transactions t ${clause}`,
      parametres
    ),
    query(
      `SELECT s.id AS service_id, s.nom AS service_nom, s.type_service, t.point_id,
              COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
              COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties,
              count(t.id)::int AS nb
       FROM finance_transactions t
       JOIN finance_services s ON s.id = t.service_id
       ${clause}
       GROUP BY s.id, s.nom, s.type_service, t.point_id
       ORDER BY entrees DESC`,
      parametres
    ),
    query(
      `SELECT s.type_service,
              COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
              COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties
       FROM finance_transactions t
       JOIN finance_services s ON s.id = t.service_id
       ${clause}
       GROUP BY s.type_service ORDER BY entrees DESC`,
      parametres
    ),
    query(
      `SELECT categorie, entrees, sorties FROM (
         SELECT t.categorie AS categorie,
                COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
                COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties
         FROM finance_transactions t ${clause}
         GROUP BY t.categorie
       ) sub ORDER BY (entrees + sorties) DESC`,
      parametres
    ),
    query(
      `SELECT mode, entrees, sorties FROM (
         SELECT t.mode AS mode,
                COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
                COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties
         FROM finance_transactions t ${clause}
         GROUP BY t.mode
       ) sub ORDER BY (entrees + sorties) DESC`,
      parametres
    ),
    query(
      `SELECT date_trunc('day', t.date_transaction)::date AS jour,
              COALESCE(SUM(CASE WHEN t.sens='ENTREE' THEN t.montant ELSE 0 END),0) AS entrees,
              COALESCE(SUM(CASE WHEN t.sens='SORTIE' THEN t.montant ELSE 0 END),0) AS sorties
       FROM finance_transactions t ${clause}
       GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
      parametres
    ),
  ]);

  const s = synthese.rows[0];
  return {
    synthese: {
      nbTransactions: s.nb,
      entrees: nombre(s.entrees),
      sorties: nombre(s.sorties),
      solde: nombre(s.entrees) - nombre(s.sorties),
    },
    parService: parService.rows.map((l) => ({
      serviceId: l.service_id,
      serviceNom: l.service_nom,
      typeService: l.type_service,
      pointId: l.point_id ?? null,
      entrees: nombre(l.entrees),
      sorties: nombre(l.sorties),
      solde: nombre(l.entrees) - nombre(l.sorties),
      nbTransactions: l.nb,
    })),
    parTypeService: parType.rows.map((l) => ({
      typeService: l.type_service,
      entrees: nombre(l.entrees),
      sorties: nombre(l.sorties),
      solde: nombre(l.entrees) - nombre(l.sorties),
    })),
    parCategorie: parCategorie.rows.map((l) => ({
      categorie: l.categorie,
      entrees: nombre(l.entrees),
      sorties: nombre(l.sorties),
    })),
    parMode: parMode.rows.map((l) => ({
      mode: l.mode,
      entrees: nombre(l.entrees),
      sorties: nombre(l.sorties),
    })),
    serieJournaliere: serie.rows
      .map((l) => ({ jour: l.jour, entrees: nombre(l.entrees), sorties: nombre(l.sorties) }))
      .reverse(),
  };
}

// -----------------------------------------------------------------------------
// Dépenses
// -----------------------------------------------------------------------------

function serialiserDepense(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    numero: ligne.numero,
    serviceId: ligne.service_id,
    serviceNom: ligne.service_nom ?? null,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    categorie: ligne.categorie,
    libelle: ligne.libelle,
    beneficiaire: ligne.beneficiaire ?? null,
    fournisseurId: ligne.fournisseur_id ?? null,
    fournisseurNom: ligne.fournisseur_nom ?? null,
    montant: nombre(ligne.montant),
    mode: ligne.mode,
    reference: ligne.reference ?? null,
    statut: ligne.statut,
    dateDepense: ligne.date_depense,
    commentaire: ligne.commentaire ?? null,
    creeParId: ligne.cree_par ?? null,
    creeParNom: ligne.cree_par_nom ?? null,
    valideParNom: ligne.valide_par_nom ?? null,
    valideLe: ligne.valide_le ?? null,
    creeLe: ligne.created_at,
  };
}

const SELECT_DEPENSE = `
  SELECT d.id, d.numero, d.service_id, d.point_id, d.categorie, d.libelle,
         d.beneficiaire, d.fournisseur_id, d.montant, d.mode, d.reference,
         d.statut, d.date_depense, d.commentaire, d.valide_le, d.created_at, d.cree_par,
         s.nom AS service_nom, po.nom AS point_nom, fo.nom AS fournisseur_nom,
         (cu.nom || ' ' || cu.prenom) AS cree_par_nom,
         (va.nom || ' ' || va.prenom) AS valide_par_nom
  FROM finance_depenses d
  JOIN finance_services s ON s.id = d.service_id
  LEFT JOIN pharmacie_points po ON po.id = d.point_id
  LEFT JOIN pharmacie_fournisseurs fo ON fo.id = d.fournisseur_id
  LEFT JOIN utilisateurs cu ON cu.id = d.cree_par
  LEFT JOIN utilisateurs va ON va.id = d.valide_par
`;

/** Liste paginée des dépenses (filtrée par périmètre). */
export async function listerDepenses(filtres = {}, utilisateur = null) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];
  const perimetre = perimetreUtilisateur(utilisateur);
  const pointId = resoudrePointId(utilisateur, filtres.pointId);

  if (pointId) {
    parametres.push(pointId);
    conditions.push(`d.point_id = $${parametres.length}`);
  } else if (!perimetre.global) {
    conditions.push('FALSE');
  }
  if (filtres.serviceId) {
    parametres.push(filtres.serviceId);
    conditions.push(`d.service_id = $${parametres.length}`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`d.statut = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`d.date_depense >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    // date_depense est un horodatage : on inclut toute la journee demandee.
    conditions.push(`d.date_depense < ($${parametres.length}::date + 1)`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    conditions.push(`(d.libelle ILIKE $${parametres.length} OR d.numero ILIKE $${parametres.length})`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM finance_depenses d ${clause}`, parametres),
    query(
      `${SELECT_DEPENSE} ${clause}
       ORDER BY d.date_depense DESC, d.created_at DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserDepense), compteur.rows[0].total, { page, limite });
}

/** Récupère une dépense ou null. */
export async function obtenirDepense(id) {
  const { rows } = await query(`${SELECT_DEPENSE} WHERE d.id = $1`, [id]);
  return rows[0] ? serialiserDepense(rows[0]) : null;
}

/** Récupère une dépense ou lève une 404. */
export async function exigerDepense(id) {
  const depense = await obtenirDepense(id);
  if (!depense) throw ApiError.notFound('Dépense introuvable.', 'DEPENSE_INTROUVABLE');
  return depense;
}

/** Crée une dépense (statut EN_ATTENTE, en attente de validation). */
export async function creerDepense(donnees, acteur = null) {
  const perimetre = perimetreUtilisateur(acteur);
  const pointId = perimetre.global ? donnees.pointId ?? null : perimetre.pointId;
  let serviceId = perimetre.global ? donnees.serviceId ?? null : null;

  if (!serviceId) {
    if (!pointId) {
      throw ApiError.badRequest(
        'Renseignez le service ou la pharmacie de la dépense.',
        'SERVICE_FINANCE_REQUIS'
      );
    }
    const { rows } = await query('SELECT fn_finance_service_point($1) AS id', [pointId]);
    serviceId = rows[0]?.id ?? null;
  }
  if (!serviceId) throw ApiError.badRequest('Service financier introuvable.', 'SERVICE_FINANCE_REQUIS');

  const { rows } = await query(
    `INSERT INTO finance_depenses
       (numero, service_id, point_id, categorie, libelle, beneficiaire, fournisseur_id,
        montant, mode, reference, date_depense, commentaire, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamptz, now()), $12, $13)
     RETURNING id`,
    [
      genererNumero('DEP'),
      serviceId,
      pointId,
      donnees.categorie ?? 'DIVERS',
      donnees.libelle,
      donnees.beneficiaire ?? null,
      donnees.fournisseurId ?? null,
      donnees.montant,
      donnees.mode ?? 'ESPECES',
      donnees.reference ?? null,
      donnees.dateDepense ?? null,
      donnees.commentaire ?? null,
      acteur?.id ?? null,
    ]
  );

  return obtenirDepense(rows[0].id);
}

/** Valide une dépense : crée l'écriture de sortie correspondante au grand livre. */
export async function validerDepense(id, donnees = {}, acteur = null) {
  const depense = await exigerDepense(id);
  if (depense.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict('Seule une dépense en attente peut être validée.', 'DEPENSE_NON_VALIDABLE');
  }

  // Séparation des tâches : celui qui soumet la dépense ne peut pas l'approuver.
  // Il dispose de l'annulation (voir annulerDepense) pour la retirer.
  if (depense.creeParId && acteur?.id && String(depense.creeParId) === String(acteur.id)) {
    throw ApiError.forbidden(
      'Vous ne pouvez pas approuver une dépense que vous avez soumise.',
      'DEPENSE_AUTO_VALIDATION'
    );
  }

  // Moyen de paiement retenu à l'approbation (sinon celui saisi à la création).
  const mode = donnees.mode ?? depense.mode;
  const compteId = donnees.compteId ?? null;
  const reference = donnees.reference !== undefined ? donnees.reference : depense.reference;

  // Le compte éventuellement retenu doit être actif et cohérent avec le moyen.
  if (compteId) {
    const { rows } = await query(
      'SELECT type, actif FROM finance_comptes WHERE id = $1',
      [compteId]
    );
    const compte = rows[0];
    if (!compte) {
      throw ApiError.notFound('Compte de paiement introuvable.', 'COMPTE_INTROUVABLE');
    }
    if (!compte.actif) {
      throw ApiError.badRequest('Ce compte de paiement est désactivé.', 'COMPTE_INACTIF');
    }
    if (compte.type === 'MOBILE_MONEY' && mode !== 'MOBILE_MONEY') {
      throw ApiError.badRequest(
        'Un compte mobile money exige le moyen de paiement « Mobile money ».',
        'MODE_COMPTE_INCOHERENT'
      );
    }
    if (compte.type === 'BANQUE' && !['VIREMENT', 'CHEQUE', 'CARTE'].includes(mode)) {
      throw ApiError.badRequest(
        'Un compte bancaire exige un virement, un chèque ou une carte.',
        'MODE_COMPTE_INCOHERENT'
      );
    }
  }

  await transaction(async (client) => {
    const transactionId = await enregistrerFlux(
      {
        serviceId: depense.serviceId,
        pointId: depense.pointId,
        compteId,
        sens: 'SORTIE',
        categorie: 'DEPENSE',
        mode,
        montant: depense.montant,
        libelle: depense.libelle,
        referenceType: 'DEPENSE',
        referenceId: depense.id,
        effectuePar: acteur?.id ?? null,
      },
      client
    );

    await client.query(
      `UPDATE finance_depenses
       SET statut = 'VALIDEE', valide_par = $1, valide_le = now(),
           transaction_id = $2, mode = $3, reference = $4
       WHERE id = $5`,
      [acteur?.id ?? null, transactionId, mode, reference ?? null, id]
    );
  });

  return obtenirDepense(id);
}

/** Rejette une dépense en attente (approbateur) : statut Annulée, sans écriture. */
export async function rejeterDepense(id, acteur = null) {
  const depense = await exigerDepense(id);
  if (depense.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict('Seule une dépense en attente peut être rejetée.', 'DEPENSE_NON_REJETABLE');
  }

  // Séparation des tâches : le rejet est une décision de validation ; l'auteur
  // retire sa dépense par l'annulation (annulerDepense).
  if (depense.creeParId && acteur?.id && String(depense.creeParId) === String(acteur.id)) {
    throw ApiError.forbidden(
      'Vous ne pouvez pas rejeter une dépense que vous avez soumise : annulez-la.',
      'DEPENSE_AUTO_VALIDATION'
    );
  }

  await query(
    `UPDATE finance_depenses SET statut = 'ANNULEE', valide_par = $1, valide_le = now() WHERE id = $2`,
    [acteur?.id ?? null, id]
  );
  return obtenirDepense(id);
}

/** Annule une dépense en attente - réservé à son créateur (sauf super admin). */
export async function annulerDepense(id, acteur = null) {
  const depense = await exigerDepense(id);
  if (depense.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette dépense est déjà annulée.', 'DEPENSE_DEJA_ANNULEE');
  }
  if (depense.statut !== 'EN_ATTENTE') {
    throw ApiError.conflict('Seule une dépense en attente peut être annulée.', 'DEPENSE_NON_ANNULEE');
  }
  if (
    !acteur?.superAdmin &&
    depense.creeParId &&
    acteur?.id &&
    String(depense.creeParId) !== String(acteur.id)
  ) {
    throw ApiError.forbidden("Seul le créateur de la dépense peut l'annuler.", 'NON_CREATEUR');
  }

  await query(
    `UPDATE finance_depenses SET statut = 'ANNULEE', valide_par = $1, valide_le = now() WHERE id = $2`,
    [acteur?.id ?? null, id]
  );
  return obtenirDepense(id);
}
