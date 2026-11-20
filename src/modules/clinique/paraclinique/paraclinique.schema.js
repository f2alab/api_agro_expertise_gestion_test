// Schémas de validation des examens paracliniques.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Types d'examen paraclinique admis. */
export const TYPES_PARACLINIQUE = [
  'IMAGERIE',
  'RADIOGRAPHIE',
  'ECHOGRAPHIE',
  'PRELEVEMENT',
  'ANALYSE_LABO',
  'AUTRE',
];

/** Statuts d'une demande paraclinique. */
export const STATUTS_PARACLINIQUE = ['DEMANDE', 'EN_COURS', 'RESULTAT', 'VALIDE', 'ANNULE'];

/** Nombre optionnel : un champ vide ou nul n'est pas converti en 0. */
const nombre = (min, max) =>
  z.preprocess(
    (valeur) => (valeur === '' || valeur === null || valeur === undefined ? undefined : valeur),
    z.coerce.number().min(min).max(max).optional().nullable()
  );

/** Texte libre optionnel. */
const texte = (max) => z.string().trim().max(max).optional().nullable();

export const schemaCreationParaclinique = z.object({
  consultationId: uuid,
  typeExamen: z.enum(TYPES_PARACLINIQUE),
  libelle: z.string().trim().min(2, "Le libellé de l'examen est requis.").max(200),
  indication: texte(2000),
  montant: nombre(0, 10_000_000),
});

/** Saisie du résultat d'un examen paraclinique. */
export const schemaResultatParaclinique = z.object({
  resultat: z.string().trim().min(2, 'Le résultat est requis.').max(8000),
  conclusion: texte(4000),
  paye: z.boolean().optional(),
  montant: nombre(0, 10_000_000),
});

export const schemaFiltresParacliniques = z.object({
  statut: z.enum(STATUTS_PARACLINIQUE).optional(),
  typeExamen: z.enum(TYPES_PARACLINIQUE).optional(),
  consultationId: uuid.optional(),
  recherche: z.string().trim().max(120).optional(),
  du: z.string().trim().max(10).optional(),
  au: z.string().trim().max(10).optional(),
});

export const schemaAnnulationParaclinique = z.object({
  motif: z.string().trim().min(3, 'Le motif est requis.').max(300),
});