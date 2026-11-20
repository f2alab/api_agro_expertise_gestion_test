// Schemas de validation des clients de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

// L'e-mail vide est traite comme absent (robustesse des formulaires).
const emailOptionnel = z.preprocess(
  (valeur) => (typeof valeur === 'string' && valeur.trim() === '' ? null : valeur),
  z.string().email('Adresse e-mail invalide.').max(180).optional().nullable()
);

export const schemaCreationClient = z.object({
  nom: z.string().trim().min(2, 'Le nom est requis.').max(150),
  telephone: z.string().trim().max(30).optional().nullable(),
  email: emailOptionnel,
  adresse: z.string().trim().max(200).optional().nullable(),
  actif: z.boolean().optional(),
  /** Pharmacie proprietaire (imposee pour un compte cloisonne). */
  pointId: uuid.optional().nullable(),
});

export const schemaModificationClient = schemaCreationClient.partial().omit({ pointId: true });

export const schemaFiltresClients = z.object({
  recherche: z.string().trim().max(120).optional(),
  actif: z.enum(['true', 'false']).optional(),
  /** Pharmacie / service (point de vente) - reserve aux comptes a portee globale. */
  pointId: uuid.optional(),
  /** Tri de la liste : nom (defaut), pharmacie, montant du, CA, achats ou ajout recent. */
  ordre: z.enum(['nom', 'pharmacie', 'montant', 'ca', 'achats', 'recent']).optional(),
});

export const schemaTopClients = z.object({
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Filtres du rapport « clients debiteurs » (ventes a credit non soldees). */
export const schemaFiltresCreances = z.object({
  recherche: z.string().trim().max(120).optional(),
  pointId: uuid.optional(),
  ordre: z.enum(['montant', 'recent', 'nom']).optional(),
});