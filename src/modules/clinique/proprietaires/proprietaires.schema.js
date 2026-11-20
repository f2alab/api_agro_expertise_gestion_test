// Schémas de validation des propriétaires d'animaux.

import { z } from 'zod';

export const TYPES_PROPRIETAIRE = ['PARTICULIER', 'ELEVEUR', 'ENTREPRISE', 'ETAT', 'ONG', 'AUTRE'];

// L'e-mail vide est traité comme absent (robustesse des formulaires).
const emailOptionnel = z.preprocess(
  (valeur) => (typeof valeur === 'string' && valeur.trim() === '' ? null : valeur),
  z.string().email('Adresse e-mail invalide.').max(180).optional().nullable()
);

export const schemaCreationProprietaire = z.object({
  nom: z.string().trim().min(2, 'Le nom est requis.').max(150),
  telephone: z.string().trim().max(30).optional().nullable(),
  telephoneSecondaire: z.string().trim().max(30).optional().nullable(),
  email: emailOptionnel,
  adresse: z.string().trim().max(200).optional().nullable(),
  ville: z.string().trim().max(120).optional().nullable(),
  typeProprietaire: z.enum(TYPES_PROPRIETAIRE).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  actif: z.boolean().optional(),
});

export const schemaModificationProprietaire = schemaCreationProprietaire.partial();

export const schemaFiltresProprietaires = z.object({
  recherche: z.string().trim().max(120).optional(),
  actif: z.enum(['true', 'false']).optional(),
  typeProprietaire: z.enum(TYPES_PROPRIETAIRE).optional(),
  ordre: z.enum(['nom', 'recent']).optional(),
});