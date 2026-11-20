// Schemas de validation des points de vente de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Nature d'un point : pharmacie du siege, succursale ou magasin central. */
export const TYPES_POINT = ['SIEGE', 'SUCCURSALE', 'MAGASIN'];

export const schemaCreationPoint = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Le code est requis.')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Le code ne peut contenir que des lettres, chiffres, tirets et tirets bas.'),
  nom: z.string().trim().min(2, 'Le nom est requis.').max(150),
  departementId: uuid.optional().nullable(),
  typePoint: z.enum(TYPES_POINT).optional(),
  ville: z.string().trim().min(2, 'La ville est requise.').max(120),
  adresse: z
    .string()
    .trim()
    .min(3, "L'adresse est requise (ex. Kégué, près de l'Echangeur).")
    .max(200),
  telephone: z.string().trim().min(6, 'Le telephone est requis.').max(30),
  email: z.string().email('Adresse e-mail invalide.').max(180).optional().nullable(),
  responsableId: uuid.optional().nullable(),
  devise: z.string().trim().max(8).optional(),
  actif: z.boolean().optional(),
});

export const schemaModificationPoint = schemaCreationPoint.partial();

export const schemaFiltresPoints = z.object({
  recherche: z.string().trim().max(120).optional(),
  typePoint: z.enum(TYPES_POINT).optional(),
  actif: z.enum(['true', 'false']).optional(),
});
