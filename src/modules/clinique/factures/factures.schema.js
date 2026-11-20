// Schémas de validation des factures de la clinique.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';
import { MODES_PAIEMENT_CLINIQUE } from '../consultations/consultations.schema.js';

/** Nombre optionnel : un champ vide ou nul n'est pas converti en 0. */
const nombre = (min, max) =>
  z.preprocess(
    (valeur) => (valeur === '' || valeur === null || valeur === undefined ? undefined : valeur),
    z.coerce.number().min(min).max(max).optional().nullable()
  );

/** Texte libre optionnel. */
const texte = (max) => z.string().trim().max(max).optional().nullable();

/**
 * Génération d'une facture globale de passage.
 * Chaque rubrique peut être incluse ou exclue : le caissier choisit ce qui
 * apparaît sur la facture remise au propriétaire.
 */
export const schemaGenerationFacture = z.object({
  consultationId: uuid,
  inclureConsultation: z.boolean().optional(),
  inclureExamens: z.boolean().optional(),
  inclureOrdonnance: z.boolean().optional(),
  inclureAutres: z.boolean().optional(),
  montantAutres: nombre(0, 100_000_000),
  designationAutres: texte(200),
  commentaire: texte(2000),
});

/** Règlement total ou partiel d'une facture. */
export const schemaPaiementFacture = z.object({
  montant: z.coerce.number().min(0.01, 'Le montant réglé est invalide.').max(100_000_000),
  mode: z.enum(MODES_PAIEMENT_CLINIQUE).optional(),
  reference: texte(80),
  compteId: uuid.optional().nullable(),
});

export const schemaFiltresFactures = z.object({
  statut: z.enum(['EMISE', 'PARTIELLE', 'PAYEE', 'ANNULEE']).optional(),
  consultationId: uuid.optional(),
  animalId: uuid.optional(),
  proprietaireId: uuid.optional(),
  du: z.string().trim().max(10).optional(),
  au: z.string().trim().max(10).optional(),
  recherche: z.string().trim().max(120).optional(),
});

export const schemaAnnulationFacture = z.object({
  motif: z.string().trim().min(3, 'Le motif est requis.').max(300),
});