
// Middleware de validation des entrées avec Zod.
// Les données validées (et nettoyées) sont exposées dans req.valide : on ne
// réaffecte jamais req.query (propriété en lecture seule dans Express 5).

import { ApiError } from '../utils/apiError.js';

/** Transforme les erreurs Zod en liste de champs lisibles par le frontend. */
export function formaterErreursZod(erreur) {
  return erreur.issues.map((probleme) => ({
    champ: probleme.path.join('.') || '(racine)',
    message: probleme.message,
  }));
}

/**
 * @param {import('zod').ZodType} schema Schéma Zod à appliquer
 * @param {'body'|'query'|'params'} source Partie de la requête à valider
 */
export const valider = (schema, source = 'body') => (req, _res, next) => {
  const resultat = schema.safeParse(req[source] ?? {});
  if (!resultat.success) {
    return next(
      ApiError.badRequest('Données invalides.', 'VALIDATION_ECHEC', formaterErreursZod(resultat.error))
    );
  }
  req.valide = resultat.data;
  next();
};