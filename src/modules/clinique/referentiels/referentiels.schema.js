// Schémas de validation des référentiels du module Clinique.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Types de référentiels admis (le frontend s'alimente de cette liste). */
export const TYPES_REFERENTIELS = [
  'ESPECE',
  'RACE',
  'MOTIF',
  'ORGANE',
  'EXAMEN_PARACLINIQUE',
  'TYPE_CONSULTATION',
];

export const schemaFiltresReferentiels = z.object({
  type: z.enum(TYPES_REFERENTIELS).optional(),
  actif: z.enum(['true', 'false']).optional(),
  recherche: z.string().trim().max(120).optional(),
});

export const schemaCreationReferentiel = z.object({
  type: z.enum(TYPES_REFERENTIELS),
  code: z.string().trim().min(2, 'Le code est requis.').max(60),
  libelle: z.string().trim().min(2, 'Le libellé est requis.').max(150),
  parentId: uuid.optional().nullable(),
  ordre: z.coerce.number().int().min(0).max(9999).optional(),
  actif: z.boolean().optional(),
});

export const schemaModificationReferentiel = schemaCreationReferentiel
  .partial()
  .omit({ type: true, code: true });