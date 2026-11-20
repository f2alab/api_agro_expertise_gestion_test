// Schemas de validation des echeances et engagements financiers.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const NATURES_ECHEANCE = ['OBLIGATION', 'ENGAGEMENT'];

export const CATEGORIES_ECHEANCE = [
  'IMPOT',
  'TAXE',
  'COTISATION_SOCIALE',
  'LOYER',
  'SALAIRE',
  'ASSURANCE',
  'FOURNISSEUR',
  'EMPRUNT',
  'ECHEANCE_CLIENT',
  'AUTRE',
];

export const PERIODICITES_ECHEANCE = [
  'UNIQUE',
  'MENSUELLE',
  'TRIMESTRIELLE',
  'SEMESTRIELLE',
  'ANNUELLE',
];

export const STATUTS_ECHEANCE = ['A_PAYER', 'PAYEE', 'ANNULEE'];

// Statut « effectif » : « EN_RETARD » est calculé à la lecture (vue SQL).
export const STATUTS_FILTRE_ECHEANCE = [...STATUTS_ECHEANCE, 'EN_RETARD'];

/** Date au format AAAA-MM-JJ (les échéances sont des dates sans heure). */
const dateIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

export const schemaFiltresEcheances = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  statut: z.enum(STATUTS_FILTRE_ECHEANCE).optional(),
  nature: z.enum(NATURES_ECHEANCE).optional(),
  categorie: z.enum(CATEGORIES_ECHEANCE).optional(),
  serviceId: uuid.optional(),
  pointId: uuid.optional(),
  du: z.string().optional(),
  au: z.string().optional(),
  recherche: z.string().trim().max(120).optional(),
  /** « true » : ne renvoyer que les échéances dont le rappel est dû. */
  rappelOnly: z.enum(['true', 'false']).optional(),
});

export const schemaCreationEcheance = z.object({
  nature: z.enum(NATURES_ECHEANCE).default('OBLIGATION'),
  categorie: z.enum(CATEGORIES_ECHEANCE).default('AUTRE'),
  libelle: z.string().trim().min(2, 'Le libellé est requis.').max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  beneficiaire: z.string().trim().max(150).optional().nullable(),
  montant: z.coerce.number().min(0, 'Le montant ne peut pas être négatif.'),
  devise: z.string().trim().max(10).optional(),
  dateEcheance: dateIso,
  periodicite: z.enum(PERIODICITES_ECHEANCE).default('UNIQUE'),
  serviceId: uuid.optional().nullable(),
  pointId: uuid.optional().nullable(),
  compteId: uuid.optional().nullable(),
  responsableId: uuid.optional().nullable(),
  alerteJours: z.coerce.number().int().min(0).max(365).default(7),
  rappelActif: z.boolean().optional(),
  reference: z.string().trim().max(80).optional().nullable(),
});

/** Modification partielle : seules les échéances « à payer » sont modifiables. */
export const schemaModificationEcheance = schemaCreationEcheance.partial();

export const schemaPaiementEcheance = z.object({
  datePaiement: dateIso.optional().nullable(),
  reference: z.string().trim().max(80).optional().nullable(),
});

export const schemaRappelEcheance = z.object({
  canal: z.enum(['APPLICATION', 'EMAIL']).optional(),
  message: z.string().trim().max(500).optional().nullable(),
});