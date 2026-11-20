// Schemas de validation des fournisseurs de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const schemaCreationFournisseur = z.object({
  // Le code est genere automatiquement par l'API (FOUR-0001...) quand il est
  // omis : le formulaire ne le demande plus. Il reste accepte pour les
  // integrations qui le fournissent explicitement.
  code: z
    .string()
    .trim()
    .min(2, 'Le code est requis.')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Le code ne peut contenir que des lettres, chiffres, tirets et tirets bas.')
    .optional(),
  nom: z.string().trim().min(2, 'Le nom est requis.').max(180),
  contact: z.string().trim().max(150).optional().nullable(),
  telephone: z.string().trim().max(30).optional().nullable(),
  email: z.string().email('Adresse e-mail invalide.').max(180).optional().nullable(),
  adresse: z.string().trim().max(200).optional().nullable(),
  ville: z.string().trim().max(120).optional().nullable(),
  pays: z.string().trim().max(120).optional(),
  nif: z.string().trim().max(60).optional().nullable(),
  conditionsPaiement: z.string().trim().max(150).optional().nullable(),
  delaiLivraisonJours: z.coerce.number().int().min(0).max(365).optional().nullable(),
  actif: z.boolean().optional(),
  // Fournisseur EXTERNE (grossiste, laboratoire) ou INTERNE (une autre
  // pharmacie du reseau : le siege approvisionne les succursales).
  typeFournisseur: z.enum(['EXTERNE', 'INTERNE']).optional(),
  // Pharmacie source lorsque le fournisseur est INTERNE.
  pointSourceId: uuid.optional().nullable(),
  // Pharmacie proprietaire du fournisseur (imposee pour un compte cloisonne).
  pointId: uuid.optional().nullable(),
});

export const schemaModificationFournisseur = schemaCreationFournisseur.partial().omit({ pointId: true });

export const schemaFiltresFournisseurs = z.object({
  recherche: z.string().trim().max(120).optional(),
  actif: z.enum(['true', 'false']).optional(),
  typeFournisseur: z.enum(['EXTERNE', 'INTERNE']).optional(),
  pointId: uuid.optional(),
});