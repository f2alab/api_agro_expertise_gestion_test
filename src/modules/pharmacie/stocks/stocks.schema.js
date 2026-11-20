// Schemas de validation des mouvements de stock de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const TYPES_MOUVEMENT = [
  'ENTREE',
  'SORTIE',
  'AJUSTEMENT',
  'TRANSFERT_ENTREE',
  'TRANSFERT_SORTIE',
  'RETOUR',
];

export const schemaMouvement = z.object({
  pointId: uuid,
  produitId: uuid,
  lotId: uuid.optional().nullable(),
  numeroLot: z.string().trim().max(80).optional().nullable(),
  datePeremption: z.coerce.date().optional().nullable(),
  typeMouvement: z.enum(TYPES_MOUVEMENT),
  quantite: z.coerce.number().int().min(1, 'La quantite doit etre positive.'),
  prixUnitaire: z.coerce.number().min(0).optional(),
  motif: z.string().trim().max(200).optional().nullable(),
  referenceType: z.string().trim().max(30).optional().nullable(),
  referenceId: uuid.optional().nullable(),
});

export const schemaFiltresMouvements = z.object({
  pointId: uuid.optional(),
  produitId: uuid.optional(),
  typeMouvement: z.enum(TYPES_MOUVEMENT).optional(),
  du: z.string().optional(),
  au: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

export const schemaFiltresStock = z.object({
  pointId: uuid.optional(),
  recherche: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

export const STATUTS_LOT = ['OK', 'PEREMPTION_PROCHE', 'PERIME', 'EPUISE'];

export const schemaFiltresAlertes = z.object({
  pointId: uuid.optional(),
  niveau: z.enum(['RUPTURE', 'SOUS_SEUIL', 'PERIME', 'PEREMPTION_PROCHE']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Filtres du listing des lots (quantite restante + peremption). */
export const schemaFiltresLots = z.object({
  pointId: uuid.optional(),
  produitId: uuid.optional(),
  statut: z.enum(STATUTS_LOT).optional(),
  recherche: z.string().trim().max(120).optional(),
  /** Ne conserve que les lots perimes au plus tard a cette date (AAAA-MM-JJ). */
  peremptionAvant: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.').optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

export const schemaCatalogue = z.object({
  pointId: uuid,
  recherche: z.string().trim().max(120).optional(),
});