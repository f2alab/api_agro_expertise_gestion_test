
// Contrôle d'accès basé sur les rôles (RBAC) : vérifie que l'utilisateur
// authentifié possède au moins une des permissions demandées.
// Un super administrateur contourne tous les contrôles.

import { ApiError } from '../utils/apiError.js';

/**
 * Exige AU MOINS UNE des permissions listées.
 * @param {...string} codes ex. autoriser('iam.users.read', 'iam.users.create')
 */
export function autoriser(...codes) {
  return (req, _res, next) => {
    if (!req.utilisateur) return next(ApiError.unauthorized());
    if (req.utilisateur.superAdmin) return next();

    const permissions = req.utilisateur.permissions ?? [];
    const accorde = codes.length === 0 || codes.some((code) => permissions.includes(code));

    if (!accorde) {
      return next(
        ApiError.forbidden(
          `Permission insuffisante (${codes.join(' ou ')}).`,
          'PERMISSION_REFUSEE',
          { permissionsRequises: codes, permissionsUtilisateur: permissions }
        )
      );
    }
    next();
  };
}

/**
 * Exige TOUTES les permissions listées.
 * @param {...string} codes
 */
export function autoriserToutes(...codes) {
  return (req, _res, next) => {
    if (!req.utilisateur) return next(ApiError.unauthorized());
    if (req.utilisateur.superAdmin) return next();

    const permissions = req.utilisateur.permissions ?? [];
    const manquantes = codes.filter((code) => !permissions.includes(code));

    if (manquantes.length > 0) {
      return next(
        ApiError.forbidden('Permissions insuffisantes.', 'PERMISSION_REFUSEE', {
          permissionsManquantes: manquantes,
        })
      );
    }
    next();
  };
}