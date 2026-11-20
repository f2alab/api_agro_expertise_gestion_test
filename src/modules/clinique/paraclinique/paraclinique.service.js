// Service des examens paracliniques : demandes (imagerie, radiographie,
// échographie, prélèvement, laboratoire), résultats et validation.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { enregistrerFlux } from '../../finances/ledger.service.js';
import {
  SERVICE_FINANCE_ANALYSE,
  arrondi,
  genererNumero,
  resoudreServiceFinance,
} from '../clinique.service.js';
import { exigerConsultation } from '../consultations/consultations.service.js';

// Demande paraclinique + consultation, animal, propriétaire et intervenants.
const SELECT_PARACLINIQUE = `
  SELECT e.id, e.numero, e.consultation_id, e.type_examen, e.libelle, e.indication,
         e.statut, e.montant, e.paye, e.resultat, e.conclusion,
         e.demande_le, e.resultat_le, e.valide_le, e.created_at, e.updated_at,
         c.numero AS consultation_numero,
         a.code AS animal_code, a.nom AS animal_nom, a.espece,
         p.nom AS proprietaire_nom,
         (d.nom || ' ' || d.prenom) AS demandeur_nom,
         (r.nom || ' ' || r.prenom) AS realisateur_nom
  FROM clinique_examens_paracliniques e
  JOIN clinique_consultations c ON c.id = e.consultation_id
  JOIN clinique_animaux a        ON a.id = c.animal_id
  JOIN clinique_proprietaires p  ON p.id = c.proprietaire_id
  LEFT JOIN utilisateurs d       ON d.id = e.demande_par
  LEFT JOIN utilisateurs r       ON r.id = e.realise_par
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserParaclinique(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    numero: ligne.numero,
    consultationId: ligne.consultation_id,
    consultationNumero: ligne.consultation_numero ?? null,
    animalCode: ligne.animal_code ?? null,
    animalNom: ligne.animal_nom ?? null,
    espece: ligne.espece ?? null,
    proprietaireNom: ligne.proprietaire_nom ?? null,
    typeExamen: ligne.type_examen,
    libelle: ligne.libelle,
    indication: ligne.indication ?? null,
    statut: ligne.statut,
    montant: Number(ligne.montant ?? 0),
    paye: Boolean(ligne.paye),
    resultat: ligne.resultat ?? null,
    conclusion: ligne.conclusion ?? null,
    demandeurNom: ligne.demandeur_nom ?? null,
    realisateurNom: ligne.realisateur_nom ?? null,
    demandeLe: ligne.demande_le,
    resultatLe: ligne.resultat_le ?? null,
    valideLe: ligne.valide_le ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les examens paracliniques (filtres statut, type, consultation, période). */
export async function listerParacliniques(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`e.statut = $${parametres.length}`);
  }
  if (filtres.typeExamen) {
    parametres.push(filtres.typeExamen);
    conditions.push(`e.type_examen = $${parametres.length}`);
  }
  if (filtres.consultationId) {
    parametres.push(filtres.consultationId);
    conditions.push(`e.consultation_id = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`e.demande_le >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`e.demande_le < ($${parametres.length}::date + interval '1 day')`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(e.numero ILIKE $${i} OR e.libelle ILIKE $${i} OR a.nom ILIKE $${i} OR p.nom ILIKE $${i})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_PARACLINIQUE} ${clause} ORDER BY e.demande_le DESC LIMIT 500`,
    parametres
  );
  return rows.map(serialiserParaclinique);
}

/** Récupère une demande ou null. */
export async function obtenirParaclinique(id) {
  const { rows } = await query(`${SELECT_PARACLINIQUE} WHERE e.id = $1`, [id]);
  return rows[0] ? serialiserParaclinique(rows[0]) : null;
}

/** Récupère une demande ou lève une 404. */
export async function exigerParaclinique(id) {
  const examen = await obtenirParaclinique(id);
  if (!examen) {
    throw ApiError.notFound('Examen paraclinique introuvable.', 'PARACLINIQUE_INTROUVABLE');
  }
  return examen;
}

/** Crée une demande d'examen paraclinique. */
export async function creerParaclinique(donnees, utilisateur = null) {
  const consultation = await exigerConsultation(donnees.consultationId);
  if (['CLOTURE', 'ANNULEE'].includes(consultation.statut)) {
    throw ApiError.conflict(
      'La consultation est clôturée : impossible de demander un nouvel examen.',
      'CONSULTATION_FIGEE',
      { statut: consultation.statut }
    );
  }

  const numero = await genererNumero('PAR');
  const { rows } = await query(
    `INSERT INTO clinique_examens_paracliniques
       (numero, consultation_id, type_examen, libelle, indication, statut, montant, demande_par)
     VALUES ($1,$2,$3,$4,$5,'DEMANDE',$6,$7)
     RETURNING id`,
    [
      numero,
      donnees.consultationId,
      donnees.typeExamen,
      donnees.libelle.trim(),
      donnees.indication ?? null,
      arrondi(donnees.montant ?? 0),
      utilisateur?.id ?? null,
    ]
  );

  // Le parcours passe à l'étape paraclinique dès qu'un examen est demandé.
  if (['ACCUEIL', 'EN_ATTENTE_PAIEMENT', 'EN_CONSULTATION'].includes(consultation.statut)) {
    await query("UPDATE clinique_consultations SET statut = 'EXAMEN_PARACLINIQUE' WHERE id = $1", [
      donnees.consultationId,
    ]);
  }

  return obtenirParaclinique(rows[0].id);
}

/** Marque une demande comme étant en cours de réalisation. */
export async function demarrerParaclinique(id, utilisateur = null) {
  const examen = await exigerParaclinique(id);
  if (examen.statut !== 'DEMANDE') {
    throw ApiError.conflict('Seule une demande en attente peut être démarrée.', 'STATUT_INVALIDE', {
      statut: examen.statut,
    });
  }
  await query(
    `UPDATE clinique_examens_paracliniques
     SET statut = 'EN_COURS', realise_par = COALESCE($2, realise_par)
     WHERE id = $1`,
    [id, utilisateur?.id ?? null]
  );
  return obtenirParaclinique(id);
}

/** Saisit le résultat d'un examen et, le cas échéant, encaisse la prestation. */
export async function enregistrerResultat(id, donnees, utilisateur = null) {
  const examen = await exigerParaclinique(id);
  if (examen.statut === 'ANNULE') {
    throw ApiError.conflict('Cet examen est annulé.', 'STATUT_INVALIDE', { statut: examen.statut });
  }

  const montant = arrondi(donnees.montant ?? examen.montant);
  const payerMaintenant = Boolean(donnees.paye) && !examen.paye;

  await query(
    `UPDATE clinique_examens_paracliniques
     SET resultat = $2, conclusion = $3, montant = $4, statut = 'RESULTAT',
         paye = COALESCE($5, paye), realise_par = COALESCE($6, realise_par), resultat_le = now()
     WHERE id = $1`,
    [
      id,
      donnees.resultat.trim(),
      donnees.conclusion ?? null,
      montant,
      donnees.paye ?? null,
      utilisateur?.id ?? null,
    ]
  );

  if (payerMaintenant && montant > 0) {
    const serviceId = await resoudreServiceFinance(SERVICE_FINANCE_ANALYSE);
    await enregistrerFlux({
      serviceId,
      sens: 'ENTREE',
      categorie: 'ANALYSE',
      mode: 'ESPECES',
      montant,
      libelle: `Examen paraclinique ${examen.numero} - ${examen.libelle}`,
      referenceType: 'CLINIQUE_PARACLINIQUE',
      referenceId: id,
      effectuePar: utilisateur?.id ?? null,
    });
  }

  return obtenirParaclinique(id);
}

/** Valide et publie un résultat. */
export async function validerParaclinique(id, utilisateur = null) {
  const examen = await exigerParaclinique(id);
  if (!['RESULTAT', 'EN_COURS'].includes(examen.statut)) {
    throw ApiError.conflict('Seul un examen avec résultat peut être validé.', 'STATUT_INVALIDE', {
      statut: examen.statut,
    });
  }
  await query(
    `UPDATE clinique_examens_paracliniques
     SET statut = 'VALIDE', valide_par = $2, valide_le = now()
     WHERE id = $1`,
    [id, utilisateur?.id ?? null]
  );
  return obtenirParaclinique(id);
}

/** Annule une demande d'examen (le motif est conservé dans la conclusion). */
export async function annulerParaclinique(id, motif) {
  const examen = await exigerParaclinique(id);
  if (examen.statut === 'VALIDE') {
    throw ApiError.conflict('Un examen validé ne peut pas être annulé.', 'STATUT_INVALIDE', {
      statut: examen.statut,
    });
  }
  await query(
    `UPDATE clinique_examens_paracliniques
     SET statut = 'ANNULE', conclusion = COALESCE(conclusion || E'\n', '') || $2
     WHERE id = $1`,
    [id, `[ANNULATION] ${motif}`]
  );
  return obtenirParaclinique(id);
}