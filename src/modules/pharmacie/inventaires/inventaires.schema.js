// Schemas de validation des inventaires de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const STATUTS_INVENTAIRE = ['OUVERT', 'CLOTURE', 'VALIDE', 'ANNULE'];

export const schemaCreationInventaire = z.object({
  pointId: uuid,
  libelle: z.string().trim().max(150).optional().nullable(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
});

export const schemaComptage = z.object({
  lignes: z
    .array(
      z.object({
        ligneId: uuid,
        quantitePhysique: z.coerce.number().int().min(0, 'Quantite invalide.'),
      })
    )
    .min(1, 'Aucune ligne de comptage fournie.'),
});

export const schemaFiltresInventaires = z.object({
  pointId: uuid.optional(),
  statut: z.enum(STATUTS_INVENTAIRE).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});