
// Catalogue des événements temps réel.
//  - chaque type fonctionnel est associé à la permission minimale pour le
//    recevoir : un utilisateur ne peut donc jamais être notifié d'un
//    changement qu'il n'a pas le droit de consulter dans l'API ;
//  - les messages publiés par PostgreSQL ne contiennent que des identifiants :
//    la normalisation garantit un format stable pour le frontend.

/** Types d'événements exposés aux navigateurs (type -> permission requise). */
export const TYPES_EVENEMENTS = Object.freeze({
  'iam.utilisateurs': 'iam.users.read',
  'iam.roles': 'iam.roles.read',
  'iam.permissions': 'iam.permissions.read',
  'iam.departements': 'iam.departments.read',
  'iam.audit': 'iam.audit.read',
  'iam.sessions': 'iam.sessions.read',

  'pharmacie.points': 'pharmacie.points.read',
  'pharmacie.produits': 'pharmacie.produits.read',
  'pharmacie.referentiels': 'pharmacie.produits.read',
  'pharmacie.stocks': 'pharmacie.stocks.read',
  'pharmacie.ventes': 'pharmacie.ventes.read',
  'pharmacie.clients': 'pharmacie.clients.read',
  'pharmacie.fournisseurs': 'pharmacie.fournisseurs.read',
  'pharmacie.commandes': 'pharmacie.commandes.read',
  'pharmacie.ravitaillements': 'pharmacie.magasin.read',
  'pharmacie.inventaires': 'pharmacie.inventaires.read',
  'pharmacie.finance': 'pharmacie.finance.read',

  // Module Clinique : un type par domaine, pour ne rafraîchir que les écrans
  // concernés (l'agent d'accueil n'est notifié que des passages et des fiches).
  'clinique.consultations': 'clinique.consultations.read',
  'clinique.animaux': 'clinique.animaux.read',
  'clinique.proprietaires': 'clinique.proprietaires.read',
  'clinique.paracliniques': 'clinique.paracliniques.read',
  'clinique.ordonnances': 'clinique.ordonnances.read',
  'clinique.factures': 'clinique.factures.read',

  'finance.services': 'finance.services.read',
  'finance.transactions': 'finance.transactions.read',
  'finance.depenses': 'finance.depenses.read',
  'finance.comptes': 'finance.comptes.read',
  'finance.echeances': 'finance.echeances.read',
});

/** Liste des types connus (utile pour la documentation et les tests). */
export const listeTypes = Object.freeze(Object.keys(TYPES_EVENEMENTS));

/** Permission nécessaire pour un type d'événement (null si type inconnu). */
export function permissionRequise(type) {
  return TYPES_EVENEMENTS[type] ?? null;
}

/**
 * Types d'événements qu'un utilisateur est autorisé à recevoir.
 * @param {{superAdmin?: boolean, permissions?: string[]}} utilisateur
 * @returns {Set<string>}
 */
export function typesAutorises(utilisateur = {}) {
  const autorises = new Set();
  const permissions = new Set(utilisateur.permissions ?? []);

  for (const [type, permission] of Object.entries(TYPES_EVENEMENTS)) {
    if (utilisateur.superAdmin || permissions.has(permission)) autorises.add(type);
  }

  return autorises;
}

const OPERATIONS = new Set(['INSERT', 'UPDATE', 'DELETE']);

/** Convertit une date quelconque en chaîne ISO 8601 (ou null). */
function horodatageIso(valeur) {
  if (!valeur) return null;
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Valide et normalise un événement (issu de PostgreSQL ou d'un service).
 * Renvoie null si l'événement est inexploitable ou de type inconnu.
 * @param {object} brut
 */
export function normaliserEvenement(brut) {
  if (!brut || typeof brut !== 'object') return null;

  const type = String(brut.type ?? '').trim();
  if (!permissionRequise(type)) return null;

  const operation = String(brut.operation ?? 'UPDATE').toUpperCase();
  const entiteId = brut.entiteId ? String(brut.entiteId) : null;
  const horodatage = horodatageIso(brut.horodatage) ?? new Date().toISOString();

  return {
    id: `${type}:${entiteId ?? brut.table ?? 'ligne'}:${horodatage}`,
    type,
    operation: OPERATIONS.has(operation) ? operation : 'UPDATE',
    table: brut.table ? String(brut.table) : null,
    entiteId,
    pointId: brut.pointId ? String(brut.pointId) : null,
    acteurId: brut.acteurId ? String(brut.acteurId) : null,
    horodatage,
  };
}
