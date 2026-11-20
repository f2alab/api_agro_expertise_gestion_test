
// Schémas de validation du module Rôles.

import { z } from 'zod';
import { uuid } from '../../utils/validations.js';

const schemaCode = z
  .string()
  .trim()
  .min(2, 'Le code est requis.')
  .max(60)
  .regex(/^[A-Za-z0-9_]+$/, 'Le code ne peut contenir que des lettres, chiffres et tirets bas.');

export const schemaCreationRole = z.object({
  code: schemaCode,
  nom: z.string().trim().min(2, 'Le nom est requis.').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  departementId: uuid.optional().nullable(),
  niveau: z.coerce.number().int().min(1).max(100).optional(),
  actif: z.boolean().optional(),
  permissionIds: z.array(uuid).max(300).optional(),
});

export const schemaModificationRole = schemaCreationRole.partial();

export const schemaPermissionsRole = z.object({
  permissionIds: z.array(uuid).max(300),
});

export const schemaFiltresRoles = z.object({
  recherche: z.string().trim().max(120).optional(),
  actif: z.enum(['true', 'false']).optional(),
});