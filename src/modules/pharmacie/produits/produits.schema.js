// Schemas de validation des produits de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Categories du referentiel (texte libre cote base, enumere cote API). */
export const CATEGORIES_PRODUIT = [
  'MEDICAMENT_VETO',
  'VACCIN',
  'ALIMENT',
  'HYGIENE',
  'MATERIEL',
  'AUTRE',
];

export const UNITES_MESURE = ['UNITE', 'FLACON', 'BOITE', 'SAC', 'SACHET', 'LITRE', 'KG', 'DOSE'];

export const schemaCreationProduit = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Le code est requis.')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Le code ne peut contenir que des lettres, chiffres, tirets et tirets bas.'),
  codeBarres: z.string().trim().max(60).optional().nullable(),
  dci: z.string().trim().max(150).optional().nullable(),
  nomCommercial: z.string().trim().min(2, 'Le nom commercial est requis.').max(180),
  formeGalenique: z.string().trim().max(60).optional().nullable(),
  dosage: z.string().trim().max(80).optional().nullable(),
  presentation: z.string().trim().max(120).optional().nullable(),
  forme: z.string().trim().max(60).optional().nullable(),
  categorie: z.string().trim().max(60).optional().nullable(),
  uniteMesure: z.string().trim().max(20).optional().nullable(),
  rayon: z.string().trim().max(60).optional().nullable(),
  necessiteOrdonnance: z.boolean().optional(),
  // Suivi du stock : produit gere par lot et/ou par date de peremption.
  gereLot: z.boolean().optional(),
  gerePeremption: z.boolean().optional(),
  tvaTaux: z.coerce.number().min(0).max(100).optional(),
  laboratoire: z.string().trim().max(150).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  actif: z.boolean().optional(),
  // Pharmacie a laquelle rattacher le produit (liste locale) et tarification
  // initiale. Un compte lie a un point de vente est rattache automatiquement.
  pointId: uuid.optional().nullable(),
  prixVente: z.coerce.number().min(0).optional(),
  prixAchatReference: z.coerce.number().min(0).optional(),
  seuilAlerte: z.coerce.number().int().min(0).optional(),
});

export const schemaModificationProduit = schemaCreationProduit.partial();

export const schemaFiltresProduits = z.object({
  recherche: z.string().trim().max(120).optional(),
  categorie: z.string().trim().max(60).optional(),
  rayon: z.string().trim().max(60).optional(),
  actif: z.enum(['true', 'false']).optional(),
  /** Restreint aux produits de la liste d'une pharmacie donnée. */
  pointId: uuid.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Parametrage d'un produit dans un point de vente (prix, seuil, dispo). */
export const schemaParametrageProduit = z.object({
  pointId: uuid,
  prixVente: z.coerce.number().min(0).optional(),
  prixAchatReference: z.coerce.number().min(0).optional(),
  seuilAlerte: z.coerce.number().int().min(0).optional(),
  quantiteMax: z.coerce.number().int().min(0).optional().nullable(),
  referenceLocale: z.string().trim().max(60).optional().nullable(),
  disponible: z.boolean().optional(),
});
