
// Schémas de validation du module Départements (organigramme).

import { z } from 'zod';
import { uuid } from '../../utils/validations.js';

export const TYPES_UNITE = ['DIRECTION', 'DEPARTEMENT', 'SERVICE', 'SUCCURSALE', 'UNITE'];

const schemaCode = z
  .string()
  .trim()
  .min(2, 'Le code est requis.')
  .max(40)
  .regex(/^[A-Za-z0-9_]+$/, 'Le code ne peut contenir que des lettres, chiffres et tirets bas.');

export const schemaCreationDepartement = z.object({
  code: schemaCode,
  nom: z.string().trim().min(2, 'Le nom est requis.').max(150),
  description: z.string().trim().max(1000).optional().nullable(),
  parentId: uuid.optional().nullable(),
  typeUnite: z.enum(TYPES_UNITE).optional(),
  ville: z.string().trim().max(120).optional().nullable(),
  ordre: z.coerce.number().int().min(0).max(9999).optional(),
  actif: z.boolean().optional(),
});

export const schemaModificationDepartement = schemaCreationDepartement.partial();

export const schemaFiltresDepartements = z.object({
  inclureInactifs: z.enum(['true', 'false']).optional(),
});