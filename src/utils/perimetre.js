
// Périmètre d'accès aux données des pharmacies.
//
// Portée GLOBALE (toutes les pharmacies, avec filtre par pharmacie) :
//   DG, DGA, Comptable, Directeur Technique, Trésorier, Auditeur
//   (et le super administrateur).
// Tout autre compte est CLOISONNÉ à la pharmacie à laquelle il est rattaché
// (responsable de pharmacie, PPV, technicien...). Un compte non global qui
// n'est rattaché à AUCUNE pharmacie n'a accès à aucune donnée (403) : c'est ce
// qui garantit qu'un responsable ne peut jamais voir les autres pharmacies.

import { ApiError } from './apiError.js';

/** Rôles disposant d'une vue consolidée (globale ou par pharmacie). */
export const ROLES_PORTEE_GLOBALE = [
  'DG',
  'DGA',
  'COMPTABLE',
  'DIR_TECHNIQUE',
  'TRESORIER',
  'AUDITEUR',
];

/** Calcule le périmètre { global, pointId } d'un profil authentifié. */
export function perimetreUtilisateur(utilisateur) {
  if (!utilisateur) return { global: false, pointId: null };
  const global = Boolean(utilisateur.superAdmin || utilisateur.porteeGlobale);
  return { global, pointId: utilisateur.pointVenteId ?? null };
}

/**
 * Résout le filtre `pointId` à appliquer à une requête.
 *  - compte global      : le point demandé, ou null (= toutes les pharmacies) ;
 *  - compte cloisonné   : TOUJOURS sa pharmacie (le point demandé est ignoré) ;
 *  - compte non rattaché: 403 (aucune donnée).
 */
export function resoudrePointId(utilisateur, pointIdDemande) {
  const perimetre = perimetreUtilisateur(utilisateur);
  if (perimetre.global) return pointIdDemande ?? null;
  if (!perimetre.pointId) {
    throw ApiError.forbidden(
      "Votre compte n'est rattaché à aucune pharmacie. Contactez un administrateur.",
      'PHARMACIE_NON_RATTACHEE'
    );
  }
  return perimetre.pointId;
}

/**
 * Vérifie qu'un compte peut agir sur un point donné. Lève 403 sinon.
 */
export function exigerPorteePoint(utilisateur, pointId) {
  const perimetre = perimetreUtilisateur(utilisateur);
  if (perimetre.global) return;
  if (perimetre.pointId && pointId && String(perimetre.pointId) === String(pointId)) return;
  throw ApiError.forbidden(
    "Votre compte n'est pas rattaché à cette pharmacie.",
    'HORS_PERIMETRE'
  );
}

/** Vérifie que le compte a une portée globale (vue toutes pharmacies). */
export function exigerPorteeGlobale(utilisateur) {
  if (perimetreUtilisateur(utilisateur).global) return;
  throw ApiError.forbidden(
    "Cette vue est réservée à la Direction (DG, DGA, Comptable, Directeur Technique).",
    'PORTEE_GLOBALE_REQUISE'
  );
}

/** Middleware Express : exige une portée globale. */
export function middlewarePorteeGlobale(req, _res, next) {
  try {
    exigerPorteeGlobale(req.utilisateur);
    next();
  } catch (erreur) {
    next(erreur);
  }
}
