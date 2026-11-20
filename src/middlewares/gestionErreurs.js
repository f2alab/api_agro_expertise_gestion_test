
// Gestion centralisée des erreurs.
// Traduit les erreurs techniques (PostgreSQL, Zod, JSON) en réponses HTTP
// propres, sans jamais exposer la pile d'appels en production.

import { config } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

/** Route inconnue : renvoie une 404 formatée. */
export function routeIntrouvable(req, _res, next) {
  next(ApiError.notFound(`Route inconnue : ${req.method} ${req.originalUrl}`, 'ROUTE_INCONNUE'));
}

// Correspondance des codes d'erreur PostgreSQL les plus fréquents
const correspondancesPostgres = {
  '23505': (erreur) =>
    ApiError.conflict('Cette valeur existe déjà.', 'DOUBLON', { contrainte: erreur.constraint }),
  '23503': () =>
    ApiError.badRequest('Référence invalide : élément lié introuvable.', 'REFERENCE_INVALIDE'),
  '23514': (erreur) =>
    ApiError.badRequest('Règle métier non respectée.', 'CONTRAINTE_NON_RESPECTEE', {
      contrainte: erreur.constraint,
    }),
  '22P02': () => ApiError.badRequest('Identifiant ou valeur mal formé(e).', 'FORMAT_INVALIDE'),
  '42P01': () =>
    ApiError.internal(
      'Schéma de base de données incomplet : exécutez les scripts SQL de backend/sql.',
      'SCHEMA_INCOMPLET'
    ),
};

// eslint-disable-next-line no-unused-vars
export function gestionnaireErreurs(erreur, req, res, _next) {
  let erreurApi = erreur;

  // 1) Erreurs PostgreSQL
  if (!(erreurApi instanceof ApiError) && erreurApi.code && correspondancesPostgres[erreurApi.code]) {
    erreurApi = correspondancesPostgres[erreurApi.code](erreurApi);
  }

  // 2) Corps JSON invalide (body-parser)
  if (!(erreurApi instanceof ApiError) && erreurApi.type === 'entity.parse.failed') {
    erreurApi = ApiError.badRequest('Corps de requête JSON invalide.', 'JSON_INVALIDE');
  }

  // 3) Erreur inattendue : journalisée intégralement, masquée pour le client
  if (!(erreurApi instanceof ApiError)) {
    logger.error(`${req.method} ${req.originalUrl} -> erreur non gérée`, erreur);
    erreurApi = ApiError.internal(
      config.estProduction ? 'Erreur interne du serveur.' : erreur.message
    );
  }

  const statut = erreurApi.statut ?? 500;
  if (statut >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${statut} ${erreurApi.code}`);
  }

  const corps = {
    succes: false,
    erreur: {
      code: erreurApi.code ?? 'ERREUR',
      message: erreurApi.message,
      ...(erreurApi.details ? { details: erreurApi.details } : {}),
    },
    horodatage: new Date().toISOString(),
  };

  if (!config.estProduction && statut >= 500) {
    corps.erreur.pile = erreur.stack;
  }

  res.status(statut).json(corps);
}