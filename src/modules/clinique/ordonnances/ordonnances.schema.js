// Schémas de validation des ordonnances de la clinique.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Nombre optionnel : un champ vide ou nul n'est pas converti en 0. */
const nombre = (min, max) =>
  z.preprocess(
    (valeur) => (valeur === '' || valeur === null || valeur === undefined ? undefined : valeur),
    z.coerce.number().min(min).max(max).optional().nullable()
  );

/** Entier optionnel (meme regle que `nombre`). */
const entier = (min, max) =>
  z.preprocess(
    (valeur) => (valeur === '' || valeur === null || valeur === undefined ? undefined : valeur),
    z.coerce.number().int().min(min).max(max).optional().nullable()
  );

/** Texte libre optionnel. */
const texte = (max) => z.string().trim().max(max).optional().nullable();

/** Ligne de prescription (produit du référentiel pharmacie). */
export const schemaLigneOrdonnance = z.object({
  produitId: uuid,
  quantite: z.coerce.number().min(0.01, 'Quantité invalide.').max(100_000),
  dosage: texte(120),
  posologie: texte(200),
  voie: texte(60),
  dureeJours: entier(0, 3650),
  prixUnitaire: nombre(0, 10_000_000),
  notes: texte(1000),
});

export const schemaCreationOrdonnance = z.object({
  consultationId: uuid,
  pointId: uuid.optional().nullable(),
  instructions: texte(4000),
  lignes: z
    .array(schemaLigneOrdonnance)
    .min(1, 'Au moins un produit est requis.')
    .max(50),
});

export const schemaModificationOrdonnance = z.object({
  pointId: uuid.optional().nullable(),
  instructions: texte(4000),
  lignes: z.array(schemaLigneOrdonnance).min(1).max(50).optional(),
});

export const schemaFiltresOrdonnances = z.object({
  statut: z.enum(['BROUILLON', 'EMISE', 'SERVIE', 'ANNULEE']).optional(),
  consultationId: uuid.optional(),
  animalId: uuid.optional(),
  du: z.string().trim().max(10).optional(),
  au: z.string().trim().max(10).optional(),
  recherche: z.string().trim().max(120).optional(),
});

/** Marquage d'une ordonnance comme servie (vente éventuellement rattachée). */
export const schemaServirOrdonnance = z.object({
  venteId: uuid.optional().nullable(),
});

/** Annulation d'une ordonnance (motif conservé dans les instructions). */
export const schemaAnnulationOrdonnance = z.object({
  motif: z.string().trim().min(3, 'Le motif est requis.').max(300),
});