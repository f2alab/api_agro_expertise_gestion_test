// Schemas de validation des commandes d'approvisionnement de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';
import { MODES_FINANCE } from '../../finances/finances.schema.js';

export const STATUTS_COMMANDE = ['BROUILLON', 'ENVOYEE', 'PARTIELLE', 'RECUE', 'ANNULEE'];

const schemaLigneCommande = z.object({
  produitId: uuid,
  quantiteCommandee: z.coerce.number().int().min(1, 'Quantite invalide.'),
  prixUnitaire: z.coerce.number().min(0),
  remise: z.coerce.number().min(0).optional(),
});

export const schemaCreationCommande = z.object({
  pointId: uuid,
  fournisseurId: uuid,
  // Brouillon (valeur par defaut cote base) ou commande directement validee/envoyee.
  statut: z.enum(['BROUILLON', 'ENVOYEE']).optional(),
  dateCommande: z.string().optional().nullable(),
  dateLivraisonPrevue: z.string().optional().nullable(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
  lignes: z.array(schemaLigneCommande).min(1, 'Au moins une ligne est requise.'),
});

export const schemaModificationCommande = z.object({
  statut: z.enum(['BROUILLON', 'ENVOYEE', 'ANNULEE']).optional(),
  dateLivraisonPrevue: z.string().optional().nullable(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
  lignes: z.array(schemaLigneCommande).optional(),
});

const schemaLigneReception = z.object({
  ligneId: uuid,
  quantiteRecue: z.coerce.number().int().min(0),
  numeroLot: z.string().trim().max(80).optional().nullable(),
  datePeremption: z.string().optional().nullable(),
});

/**
 * Reception d'une commande fournisseur. Pour un fournisseur EXTERNE, le montant
 * de facture et le mode de reglement alimentent l'ecriture de tresorerie
 * (SORTIE / ACHAT) creee par le service ; un fournisseur interne (transfert dans
 * le groupe) ne genere aucune sortie d'argent.
 */
export const schemaReception = z.object({
  dateReception: z.string().optional().nullable(),
  numeroFacture: z.string().trim().max(80).optional().nullable(),
  montantFacture: z.coerce.number().min(0).optional(),
  // Mode de reglement de la facture fournisseur (memes valeurs que le grand livre).
  modePaiement: z.enum(MODES_FINANCE).optional(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
  lignes: z.array(schemaLigneReception).min(1, 'Indiquez au moins une quantite recue.'),
});

/**
 * Reglement d'une facture fournisseur (versement complementaire ou paiement
 * effectue apres la reception).
 */
export const schemaReglement = z.object({
  dateReglement: z.string().optional().nullable(),
  montant: z.coerce.number().positive('Le montant doit etre positif.'),
  mode: z.enum(MODES_FINANCE).default('ESPECES'),
  reference: z.string().trim().max(80).optional().nullable(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
});

/** Filtres de la file d'attente des reglements a valider. */
export const schemaFiltresReglements = z.object({
  pointId: uuid.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Rejet d'une demande de reglement (motif facultatif). */
export const schemaRejetReglement = z.object({
  motif: z.string().trim().max(500).optional().nullable(),
});

export const schemaFiltresCommandes = z.object({
  pointId: uuid.optional(),
  fournisseurId: uuid.optional(),
  statut: z.enum(STATUTS_COMMANDE).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});