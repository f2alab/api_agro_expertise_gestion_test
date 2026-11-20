
// Schémas de validation partagés par les modules (Zod).

import { z } from 'zod';

/** Identifiant UUID (clés primaires de la base). */
export const uuid = z.string().uuid('Identifiant invalide.');

/**
 * Politique de mot de passe : 8 caractères minimum,
 * au moins une minuscule, une majuscule et un chiffre.
 */
export const schemaMotDePasse = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(128, 'Le mot de passe est trop long.')
  .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule.')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule.')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.');

/** Paramètres de pagination communs. */
export const schemaPagination = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Corps contenant une liste d'identifiants (affectations). */
export const schemaListeIds = z.object({
  ids: z.array(uuid).max(200),
});