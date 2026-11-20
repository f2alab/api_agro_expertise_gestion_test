
// Schémas de validation du module Finance (transversal).

import { z } from 'zod';
import { uuid } from '../../utils/validations.js';

const MODES = ['ESPECES', 'MOBILE_MONEY', 'CHEQUE', 'VIREMENT', 'CARTE', 'CREDIT'];
const SENS = ['ENTREE', 'SORTIE'];
const CATEGORIES = [
  'VENTE', 'ACHAT', 'DEPENSE', 'SALAIRE', 'TRANSFERT', 'APPORT', 'FONDS_DEPART',
  'CONSULTATION', 'ANALYSE', 'REMBOURSEMENT', 'AUTRE',
];
const ORIGINES = ['OPERATIONNELLE', 'HORS_OPERATION'];
const TYPES_SERVICE = ['PHARMACIE', 'CONSULTATION', 'ANALYSE', 'LABORATOIRE', 'HOSPITALISATION', 'AUTRE'];

export const schemaFiltresServices = z.object({
  recherche: z.string().trim().max(120).optional(),
  typeService: z.enum(TYPES_SERVICE).optional(),
  actif: z.enum(['true', 'false']).optional(),
});

export const schemaFiltresTransactions = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  serviceId: uuid.optional(),
  pointId: uuid.optional(),
  compteId: uuid.optional(),
  sens: z.enum(SENS).optional(),
  categorie: z.enum(CATEGORIES).optional(),
  /** Filtre transversal : flux d'exploitation ou entrées hors ventes. */
  origine: z.enum(ORIGINES).optional(),
  mode: z.enum(MODES).optional(),
  du: z.string().optional(),
  au: z.string().optional(),
  recherche: z.string().trim().max(120).optional(),
});

export const schemaCreationTransaction = z.object({
  serviceId: uuid.optional().nullable(),
  pointId: uuid.optional().nullable(),
  compteId: uuid.optional().nullable(),
  sens: z.enum(SENS),
  categorie: z.enum(CATEGORIES).default('AUTRE'),
  mode: z.enum(MODES).default('ESPECES'),
  montant: z.coerce.number().positive('Le montant doit être positif.'),
  libelle: z.string().trim().max(200).optional().nullable(),
  referenceType: z.string().trim().max(40).optional().nullable(),
  referenceId: uuid.optional().nullable(),
  dateTransaction: z.string().optional().nullable(),
});

export const schemaFiltresDepenses = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  serviceId: uuid.optional(),
  pointId: uuid.optional(),
  statut: z.enum(['EN_ATTENTE', 'VALIDEE', 'ANNULEE']).optional(),
  du: z.string().optional(),
  au: z.string().optional(),
  recherche: z.string().trim().max(120).optional(),
});

export const schemaCreationDepense = z.object({
  serviceId: uuid.optional().nullable(),
  pointId: uuid.optional().nullable(),
  categorie: z.string().trim().max(60).default('DIVERS'),
  libelle: z.string().trim().min(2, 'Le libellé est requis.').max(200),
  beneficiaire: z.string().trim().max(150).optional().nullable(),
  fournisseurId: uuid.optional().nullable(),
  montant: z.coerce.number().positive('Le montant doit être positif.'),
  mode: z.enum(MODES).default('ESPECES'),
  reference: z.string().trim().max(80).optional().nullable(),
  dateDepense: z.string().optional().nullable(),
  commentaire: z.string().trim().max(1000).optional().nullable(),
});

/** Validation (approbation) d'une dépense : moyen de paiement retenu. */
export const schemaValidationDepense = z.object({
  mode: z.enum(MODES).optional(),
  compteId: uuid.optional().nullable(),
  reference: z.string().trim().max(80).optional().nullable(),
});

export const schemaFiltresIndicateurs = z.object({
  serviceId: uuid.optional(),
  pointId: uuid.optional(),
  du: z.string().optional(),
  au: z.string().optional(),
});

export const TYPES_SERVICE_FINANCE = TYPES_SERVICE;
export const MODES_FINANCE = MODES;
export const CATEGORIES_FINANCE = CATEGORIES;
