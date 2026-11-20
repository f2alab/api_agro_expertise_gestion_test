// Schemas de validation des referentiels produits.

import { z } from 'zod';

export const TYPES_REFERENTIEL = ['CATEGORIE', 'UNITE', 'RAYON', 'FORME'];

export const schemaFiltresReferentiels = z.object({
  type: z.enum(TYPES_REFERENTIEL).optional(),
  actif: z.enum(['true', 'false']).optional(),
  recherche: z.string().trim().max(120).optional(),
});

export const schemaCreationReferentiel = z.object({
  type: z.enum(TYPES_REFERENTIEL),
  libelle: z.string().trim().min(1, 'Le libelle est requis.').max(150),
  description: z.string().trim().max(500).optional().nullable(),
});

/** Le code est genere automatiquement et le type n'est pas modifiable. */
export const schemaModificationReferentiel = z.object({
  libelle: z.string().trim().min(1, 'Le libelle est requis.').max(150).optional(),
  description: z.string().trim().max(500).optional().nullable(),
});