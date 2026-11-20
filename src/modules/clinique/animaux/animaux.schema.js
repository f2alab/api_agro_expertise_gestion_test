// Schémas de validation des fiches animaux.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const SEXES = ['M', 'F', 'INCONNU'];
export const STATUTS_ANIMAL = ['VIVANT', 'MORT', 'DEPLACE', 'ABANDONNE'];

export const schemaCreationAnimal = z.object({
  proprietaireId: uuid,
  nom: z.string().trim().max(120).optional().nullable(),
  espece: z.string().trim().min(2, "L'espèce est requise.").max(80),
  race: z.string().trim().max(80).optional().nullable(),
  sexe: z.enum(SEXES).optional(),
  dateNaissance: z.string().trim().max(10).optional().nullable(),
  ageEstime: z.string().trim().max(40).optional().nullable(),
  poidsKg: z.coerce.number().min(0).max(20000).optional().nullable(),
  robe: z.string().trim().max(80).optional().nullable(),
  identification: z.string().trim().max(120).optional().nullable(),
  signesParticuliers: z.string().trim().max(2000).optional().nullable(),
  statut: z.enum(STATUTS_ANIMAL).optional(),
});

export const schemaModificationAnimal = schemaCreationAnimal
  .partial()
  .omit({ proprietaireId: true });

export const schemaFiltresAnimaux = z.object({
  recherche: z.string().trim().max(120).optional(),
  proprietaireId: uuid.optional(),
  espece: z.string().trim().max(80).optional(),
  statut: z.enum(STATUTS_ANIMAL).optional(),
  ordre: z.enum(['nom', 'recent']).optional(),
});