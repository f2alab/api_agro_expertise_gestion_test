// Schemas de validation du module Parametres.

import { z } from 'zod';

/**
 * Valeur d'un parametre : scalaire (booleen, nombre, texte) ou structure JSON.
 * Le stockage est JSONB : l'API renvoie la valeur deja typee.
 */
const valeurParametre = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const schemaMajParametre = z.object({
  valeur: valeurParametre,
});