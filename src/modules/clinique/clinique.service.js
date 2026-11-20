// Service partagé du module Clinique.
// Regroupe les helpers transverses : numérotation, tarif de consultation,
// résolution des services financiers et contrôle du workflow.
// Aucun SQL métier ici : les sous-modules gardent leurs propres requêtes.

import { query } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';
import { lireParametre } from '../parametres/parametres.service.js';

/** Tarif appliqué si le paramètre n'est pas encore renseigné (5 000 F CFA). */
export const FRAIS_CONSULTATION_DEFAUT = 5000;

/** Services financiers du grand livre utilisés par la clinique (18_finances_seed.sql). */
export const SERVICE_FINANCE_CONSULTATION = 'CLIN-CONSULT';
export const SERVICE_FINANCE_ANALYSE = 'CLIN-ANALYSE';

/** Statuts de la consultation, dans l'ordre du parcours de prise en charge. */
export const STATUTS_CONSULTATION = [
  'ACCUEIL',
  'EN_ATTENTE_PAIEMENT',
  'EN_CONSULTATION',
  'EXAMEN_PARACLINIQUE',
  'RESULTATS',
  'ORDONNANCE',
  'CLOTURE',
  'ANNULEE',
];

/** Statuts à partir desquels la consultation n'est plus modifiable. */
export const STATUTS_FIGES = ['CLOTURE', 'ANNULEE'];

/** Arrondi monétaire à deux décimales (évite les dérives flottantes). */
export const arrondi = (valeur) => Math.round((Number(valeur) || 0) * 100) / 100;

/** Exécute une requête sur le client d'une transaction, ou sur le pool partagé. */
export const executer = (client) => (texte, parametres) =>
  client ? client.query(texte, parametres) : query(texte, parametres);

/**
 * Lit le tarif de consultation en vigueur (paramètre administrable).
 * Le montant est FIGÉ sur la consultation : une révision ultérieure du tarif ne
 * modifie jamais les passages déjà enregistrés.
 */
export async function lireFraisConsultation(client = null) {
  const valeur = await lireParametre(
    'clinique.consultation.frais',
    FRAIS_CONSULTATION_DEFAUT,
    client
  );
  const montant = Number(valeur);
  return Number.isFinite(montant) && montant >= 0 ? arrondi(montant) : FRAIS_CONSULTATION_DEFAUT;
}

/** Génère un numéro du module (ex. CONS-2026-000123, PROP-000001). */
export async function genererNumero(
  prefixe,
  { avecAnnee = true, longueur = 6, client = null } = {}
) {
  const { rows } = await executer(client)('SELECT fn_clinique_numero($1, $2, $3) AS numero', [
    prefixe,
    avecAnnee ? new Date().getFullYear() : null,
    longueur,
  ]);
  return rows[0].numero;
}

/** Identifiant du service financier portant un code donné (null si absent). */
export async function resoudreServiceFinance(code, client = null) {
  const { rows } = await executer(client)('SELECT id FROM finance_services WHERE code = $1', [code]);
  return rows[0]?.id ?? null;
}

/** Lève une erreur 409 si la consultation n'est plus modifiable. */
export function exigerModifiable(consultation, action = 'modifier') {
  if (STATUTS_FIGES.includes(consultation.statut)) {
    const etat = consultation.statut === 'CLOTURE' ? 'clôturée' : 'annulée';
    throw ApiError.conflict(
      `Impossible de ${action} : la consultation ${consultation.numero} est ${etat}.`,
      'CONSULTATION_FIGEE',
      { statut: consultation.statut }
    );
  }
}