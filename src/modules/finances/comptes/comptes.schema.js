// Schemas de validation des comptes de paiement (mobile money / banque).

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const TYPES_COMPTE = ['MOBILE_MONEY', 'BANQUE'];

export const schemaFiltresComptes = z.object({
  type: z.enum(TYPES_COMPTE).optional(),
  pointId: uuid.optional(),
  actif: z.enum(['true', 'false']).optional(),
  recherche: z.string().trim().max(120).optional(),
});

export const schemaCreationCompte = z.object({
  type: z.enum(TYPES_COMPTE),
  prestataire: z.string().trim().min(1, 'Le prestataire est requis.').max(120),
  libelle: z.string().trim().max(150).optional().nullable(),
  numero: z.string().trim().min(1, 'Le numéro est requis.').max(60),
  titulaire: z.string().trim().max(150).optional().nullable(),
  pointId: uuid.optional().nullable(),
  actif: z.boolean().optional(),
});

/** Le type d'un compte n'est pas modifiable. */
export const schemaModificationCompte = schemaCreationCompte.partial().omit({ type: true });

/** Comptes utilisables pour une operation (filtre par moyen de paiement). */
export const schemaFiltresDisponibles = z.object({
  type: z.enum(TYPES_COMPTE).optional(),
  pointId: uuid.optional(),
});