// Service des echeances et engagements financiers.
// Suit les obligations et engagements du groupe, calcule les niveaux d'alerte et
// journalise les rappels adresses a la DG, la DGA et le Comptable.

import { randomUUID } from 'node:crypto';
import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';
import { perimetreUtilisateur, resoudrePointId } from '../../../utils/perimetre.js';

const nombre = (valeur) => Number(valeur ?? 0);

/** Genere un numero unique (prefixe + date + suffixe aleatoire). */
function genererNumero(prefixe) {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  return `${prefixe}-${jour}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

/** Transforme une ligne de la vue en objet JSON destine a l'API. */
function serialiserEcheance(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    numero: ligne.numero,
    nature: ligne.nature,
    categorie: ligne.categorie,
    libelle: ligne.libelle,
    description: ligne.description ?? null,
    beneficiaire: ligne.beneficiaire ?? null,
    montant: nombre(ligne.montant),
    devise: ligne.devise,
    dateEcheance: ligne.date_echeance,
    periodicite: ligne.periodicite,
    serviceId: ligne.service_id ?? null,
    serviceNom: ligne.service_nom ?? null,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    compteId: ligne.compte_id ?? null,
    comptePrestataire: ligne.compte_prestataire ?? null,
    compteNumero: ligne.compte_numero ?? null,
    responsableId: ligne.responsable_id ?? null,
    responsableNom: ligne.responsable_nom ?? null,
    alerteJours: ligne.alerte_jours,
    rappelActif: Boolean(ligne.rappel_actif),
    statut: ligne.statut,
    statutEffectif: ligne.statut_effectif ?? ligne.statut,
    niveauAlerte: ligne.niveau_alerte ?? 'OK',
    joursRestants: ligne.jours_restants ?? null,
    datePaiement: ligne.date_paiement ?? null,
    reference: ligne.reference ?? null,
    payeParNom: ligne.paye_par_nom ?? null,
    payeLe: ligne.paye_le ?? null,
    creeParNom: ligne.cree_par_nom ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/**
 * Clause de perimetre : un compte cloisonne ne voit que les echeances de sa
 * pharmacie ; un compte non rattache ne voit rien (FALSE).
 */
function clausesPerimetre(utilisateur, pointIdDemande) {
  const perimetre = perimetreUtilisateur(utilisateur);
  const pointId = resoudrePointId(utilisateur, pointIdDemande);
  if (pointId) return { conditions: ['e.point_id = $1'], parametres: [pointId] };
  if (!perimetre.global) return { conditions: ['FALSE'], parametres: [] };
  return { conditions: [], parametres: [] };
}

/** Liste paginee des echeances (filtres + perimetre). */
export async function listerEcheances(filtres = {}, utilisateur = null) {
  const { page, limite, offset } = lirePagination(filtres);
  const { conditions, parametres } = clausesPerimetre(utilisateur, filtres.pointId);

  const ajouter = (condition, valeur) => {
    parametres.push(valeur);
    conditions.push(condition.replace('$?', `$${parametres.length}`));
  };

  if (filtres.statut) ajouter('e.statut_effectif = $?', filtres.statut);
  if (filtres.nature) ajouter('e.nature = $?', filtres.nature);
  if (filtres.categorie) ajouter('e.categorie = $?', filtres.categorie);
  if (filtres.serviceId) ajouter('e.service_id = $?', filtres.serviceId);
  if (filtres.du) ajouter('e.date_echeance >= $?::date', filtres.du);
  if (filtres.au) ajouter('e.date_echeance <= $?::date', filtres.au);
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(e.libelle ILIKE $${i} OR e.numero ILIKE $${i} OR e.beneficiaire ILIKE $${i})`
    );
  }
  if (filtres.rappelOnly === 'true') {
    conditions.push(
      `e.statut_effectif IN ('A_PAYER','EN_RETARD')
         AND e.rappel_actif
         AND e.date_echeance <= CURRENT_DATE + e.alerte_jours`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM v_finance_echeances e ${clause}`, parametres),
    query(
      `SELECT e.* FROM v_finance_echeances e ${clause}
       ORDER BY CASE e.statut_effectif
                  WHEN 'EN_RETARD' THEN 0 WHEN 'A_PAYER' THEN 1 ELSE 2 END,
                e.date_echeance ASC, e.created_at DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserEcheance), compteur.rows[0].total, {
    page,
    limite,
  });
}

/** Recupere une echeance ou null. */
export async function obtenirEcheance(id) {
  const { rows } = await query('SELECT e.* FROM v_finance_echeances e WHERE e.id = $1', [id]);
  return rows[0] ? serialiserEcheance(rows[0]) : null;
}

/** Recupere une echeance ou leve une 404. */
export async function exigerEcheance(id) {
  const echeance = await obtenirEcheance(id);
  if (!echeance) throw ApiError.notFound('Échéance introuvable.', 'ECHEANCE_INTROUVABLE');
  return echeance;
}

/** Indicateurs consolides : compteurs, montants et rappels dus. */
export async function indicateursEcheances(utilisateur = null) {
  const { conditions, parametres } = clausesPerimetre(utilisateur);
  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE e.statut_effectif = 'A_PAYER')::int   AS a_payer,
       count(*) FILTER (WHERE e.statut_effectif = 'EN_RETARD')::int AS en_retard,
       count(*) FILTER (WHERE e.statut_effectif = 'PAYEE')::int     AS payees,
       count(*) FILTER (WHERE e.statut_effectif = 'ANNULEE')::int   AS annulees,
       count(*) FILTER (WHERE e.nature = 'OBLIGATION'
                          AND e.statut_effectif IN ('A_PAYER','EN_RETARD'))::int AS obligations,
       count(*) FILTER (WHERE e.nature = 'ENGAGEMENT'
                          AND e.statut_effectif IN ('A_PAYER','EN_RETARD'))::int AS engagements,
       COALESCE(SUM(e.montant) FILTER (
         WHERE e.statut_effectif IN ('A_PAYER','EN_RETARD')), 0) AS montant_a_payer,
       COALESCE(SUM(e.montant) FILTER (WHERE e.statut_effectif = 'EN_RETARD'), 0) AS montant_en_retard,
       count(*) FILTER (WHERE e.statut_effectif IN ('A_PAYER','EN_RETARD')
                          AND e.rappel_actif
                          AND e.date_echeance <= CURRENT_DATE + e.alerte_jours)::int AS rappels_dus
     FROM v_finance_echeances e ${clause}`,
    parametres
  );

  const l = rows[0];
  return {
    total: l.total,
    aPayer: l.a_payer,
    enRetard: l.en_retard,
    payees: l.payees,
    annulees: l.annulees,
    obligations: l.obligations,
    engagements: l.engagements,
    montantAPayer: nombre(l.montant_a_payer),
    montantEnRetard: nombre(l.montant_en_retard),
    rappelsDus: l.rappels_dus,
  };
}

/**
 * Rappels dus : echeances non reglees dont la date tombe dans la fenetre
 * d'alerte (ou deja depassee). Chaque rappel indique s'il a deja ete journalise
 * pour son niveau courant (`dejaRappele`).
 */
export async function listerRappelsDus(utilisateur = null) {
  const { conditions, parametres } = clausesPerimetre(utilisateur);
  conditions.push(
    "e.statut_effectif IN ('A_PAYER','EN_RETARD')",
    'e.rappel_actif',
    'e.date_echeance <= CURRENT_DATE + e.alerte_jours'
  );
  const clause = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await query(
    `SELECT e.*,
            EXISTS (
              SELECT 1 FROM finance_echeances_rappels r
              WHERE r.echeance_id = e.id AND r.niveau = e.niveau_alerte
            ) AS deja_rappele
     FROM v_finance_echeances e ${clause}
     ORDER BY e.date_echeance ASC, e.created_at DESC`,
    parametres
  );

  return rows.map((ligne) => ({
    ...serialiserEcheance(ligne),
    dejaRappele: Boolean(ligne.deja_rappele),
  }));
}

/** Cree une nouvelle echeance (obligation ou engagement financier). */
export async function creerEcheance(donnees, acteur = null) {
  const perimetre = perimetreUtilisateur(acteur);
  let pointId = perimetre.global ? donnees.pointId ?? null : perimetre.pointId;
  const serviceId = donnees.serviceId ?? null;

  // Un service rattache une pharmacie : on en deduit le point de vente.
  if (serviceId) {
    const { rows } = await query('SELECT id, point_id FROM finance_services WHERE id = $1', [
      serviceId,
    ]);
    if (rows.length === 0) {
      throw ApiError.badRequest('Service financier introuvable.', 'SERVICE_FINANCE_INTROUVABLE');
    }
    if (!pointId) pointId = rows[0].point_id ?? null;
  }
  if (donnees.compteId) {
    const { rowCount } = await query('SELECT 1 FROM finance_comptes WHERE id = $1', [
      donnees.compteId,
    ]);
    if (rowCount === 0) {
      throw ApiError.badRequest('Compte de paiement introuvable.', 'COMPTE_INTROUVABLE');
    }
  }
  if (donnees.responsableId) {
    const { rowCount } = await query('SELECT 1 FROM utilisateurs WHERE id = $1', [
      donnees.responsableId,
    ]);
    if (rowCount === 0) {
      throw ApiError.badRequest('Responsable introuvable.', 'RESPONSABLE_INTROUVABLE');
    }
  }

  const { rows } = await query(
    `INSERT INTO finance_echeances
       (numero, nature, categorie, libelle, description, beneficiaire, montant, devise,
        date_echeance, periodicite, service_id, point_id, compte_id, responsable_id,
        alerte_jours, rappel_actif, reference, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      genererNumero('ECH'),
      donnees.nature ?? 'OBLIGATION',
      donnees.categorie ?? 'AUTRE',
      donnees.libelle,
      donnees.description ?? null,
      donnees.beneficiaire ?? null,
      donnees.montant ?? 0,
      donnees.devise ?? 'XOF',
      donnees.dateEcheance,
      donnees.periodicite ?? 'UNIQUE',
      serviceId,
      pointId,
      donnees.compteId ?? null,
      donnees.responsableId ?? null,
      donnees.alerteJours ?? 7,
      donnees.rappelActif ?? true,
      donnees.reference ?? null,
      acteur?.id ?? null,
    ]
  );

  return obtenirEcheance(rows[0].id);
}

const CORRESPONDANCES = {
  nature: 'nature',
  categorie: 'categorie',
  libelle: 'libelle',
  description: 'description',
  beneficiaire: 'beneficiaire',
  montant: 'montant',
  devise: 'devise',
  dateEcheance: 'date_echeance',
  periodicite: 'periodicite',
  serviceId: 'service_id',
  pointId: 'point_id',
  compteId: 'compte_id',
  responsableId: 'responsable_id',
  alerteJours: 'alerte_jours',
  rappelActif: 'rappel_actif',
  reference: 'reference',
};

/** Modifie une echeance non encore reglee (statut A_PAYER). */
export async function modifierEcheance(id, donnees) {
  const echeance = await exigerEcheance(id);
  if (echeance.statut !== 'A_PAYER') {
    throw ApiError.conflict(
      'Seule une échéance à payer peut être modifiée.',
      'ECHEANCE_NON_MODIFIABLE'
    );
  }

  const champs = [];
  const valeurs = [];
  for (const [cle, colonne] of Object.entries(CORRESPONDANCES)) {
    if (donnees[cle] === undefined) continue;
    let valeur = donnees[cle];
    if (cle === 'libelle') valeur = String(valeur).trim();
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  }

  if (champs.length > 0) {
    valeurs.push(id);
    await query(
      `UPDATE finance_echeances SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
      valeurs
    );
  }
  return obtenirEcheance(id);
}

/** Marque une echeance comme reglee (paiement effectif). */
export async function marquerEcheancePayee(id, donnees = {}, acteur = null) {
  const echeance = await exigerEcheance(id);
  if (echeance.statut === 'PAYEE') {
    throw ApiError.conflict('Cette échéance est déjà réglée.', 'ECHEANCE_DEJA_PAYEE');
  }
  if (echeance.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette échéance est annulée.', 'ECHEANCE_ANNULEE');
  }

  await query(
    `UPDATE finance_echeances
        SET statut = 'PAYEE',
            date_paiement = COALESCE($2::date, CURRENT_DATE),
            reference = COALESCE($3, reference),
            paye_par = $4,
            paye_le = now()
      WHERE id = $1`,
    [id, donnees.datePaiement ?? null, donnees.reference ?? null, acteur?.id ?? null]
  );
  return obtenirEcheance(id);
}

/** Annule une echeance non reglee. */
export async function annulerEcheance(id) {
  const echeance = await exigerEcheance(id);
  if (echeance.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette échéance est déjà annulée.', 'ECHEANCE_DEJA_ANNULEE');
  }
  if (echeance.statut === 'PAYEE') {
    throw ApiError.conflict(
      'Une échéance réglée ne peut pas être annulée.',
      'ECHEANCE_PAYEE'
    );
  }
  await query("UPDATE finance_echeances SET statut = 'ANNULEE' WHERE id = $1", [id]);
  return obtenirEcheance(id);
}

/** Compose le message par defaut d'un rappel. */
function construireMessage(echeance) {
  const montant = `${nombre(echeance.montant).toLocaleString('fr-FR')} ${echeance.devise}`;
  const beneficiaire = echeance.beneficiaire ? ` - bénéficiaire : ${echeance.beneficiaire}` : '';
  return `Rappel : « ${echeance.libelle} » (${montant}) - échéance du ${echeance.dateEcheance}${beneficiaire}.`;
}

const SELECT_RAPPEL = `
  SELECT r.id, r.echeance_id, r.niveau, r.canal, r.destinataires, r.message, r.envoye_le,
         (u.nom || ' ' || u.prenom) AS envoye_par_nom
  FROM finance_echeances_rappels r
  LEFT JOIN utilisateurs u ON u.id = r.envoye_par
`;

function serialiserRappel(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    echeanceId: ligne.echeance_id,
    niveau: ligne.niveau,
    canal: ligne.canal,
    destinataires: ligne.destinataires,
    message: ligne.message ?? null,
    envoyeParNom: ligne.envoye_par_nom ?? null,
    envoyeLe: ligne.envoye_le,
  };
}

/** Recupere un rappel ou null. */
export async function obtenirRappel(id) {
  const { rows } = await query(`${SELECT_RAPPEL} WHERE r.id = $1`, [id]);
  return rows[0] ? serialiserRappel(rows[0]) : null;
}

/** Historique des rappels d'une echeance. */
export async function listerRappelsEcheance(echeanceId) {
  await exigerEcheance(echeanceId);
  const { rows } = await query(
    `${SELECT_RAPPEL} WHERE r.echeance_id = $1 ORDER BY r.envoye_le DESC`,
    [echeanceId]
  );
  return rows.map(serialiserRappel);
}

/**
 * Enregistre un rappel d'echeance adresse aux profils de pilotage (DG, DGA,
 * Comptable). Tant qu'aucun service d'e-mail n'est branche, le rappel est
 * consigne dans le journal et s'affiche dans la cloche de la barre superieure.
 */
export async function enregistrerRappelEcheance(id, donnees = {}, acteur = null) {
  const echeance = await exigerEcheance(id);
  if (echeance.statutEffectif === 'PAYEE' || echeance.statutEffectif === 'ANNULEE') {
    throw ApiError.conflict(
      'Impossible de rappeler une échéance réglée ou annulée.',
      'ECHEANCE_NON_RAPPELABLE'
    );
  }

  const niveau = echeance.niveauAlerte === 'OK' ? 'MANUEL' : echeance.niveauAlerte;
  const message = donnees.message?.trim() || construireMessage(echeance);

  const { rows } = await query(
    `INSERT INTO finance_echeances_rappels (echeance_id, niveau, canal, message, envoye_par)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [id, niveau, donnees.canal ?? 'APPLICATION', message, acteur?.id ?? null]
  );

  return obtenirRappel(rows[0].id);
}