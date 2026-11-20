// Schemas de validation du magasin central de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/**
 * Une ligne de demande de ravitaillement : produit et quantite a transferer.
 * `commandeLigneId` est renseigne lorsque la quantite provient d'une commande
 * `ENVOYEE` de la pharmacie de destination (quantite eventuellement ajustee).
 */
const schemaLigneRavitaillement = z.object({
  produitId: uuid,
  commandeLigneId: uuid.optional().nullable(),
  quantite: z.coerce.number().int().min(1, 'La quantite doit etre positive.'),
});

export const schemaRavitaillement = z.object({
  pointDestinationId: uuid,
  commandeId: uuid.optional().nullable(),
  commentaire: z.string().trim().max(200).optional().nullable(),
  lignes: z.array(schemaLigneRavitaillement).min(1, 'Selectionnez au moins un produit.'),
});

/** Filtres de chargement des commandes a ravitailler (mode « depuis une commande »). */
export const schemaFiltresCommandesARavitailler = z.object({
  pointDestinationId: uuid,
});

/** Filtres de la liste des demandes de ravitaillement. */
export const schemaFiltresRavitaillements = z.object({
  statut: z.enum(['EN_ATTENTE', 'APPROUVE', 'REJETE']).optional(),
  pointDestinationId: uuid.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Rejet d'une demande de ravitaillement (motif facultatif). */
export const schemaRejetRavitaillement = z.object({
  motif: z.string().trim().max(500).optional().nullable(),
});

/** Une ligne de commande fournisseur pour le magasin. */
const schemaLigneCommande = z.object({
  produitId: uuid,
  quantiteCommandee: z.coerce.number().int().min(1, 'Quantite invalide.'),
  prixUnitaire: z.coerce.number().min(0),
  remise: z.coerce.number().min(0).optional(),
});

export const schemaCommandeMagasin = z.object({
  fournisseurId: uuid,
  statut: z.enum(['BROUILLON', 'ENVOYEE']).optional(),
  dateCommande: z.string().optional().nullable(),
  dateLivraisonPrevue: z.string().optional().nullable(),
  commentaire: z.string().trim().max(2000).optional().nullable(),
  lignes: z.array(schemaLigneCommande).min(1, 'Au moins une ligne est requise.'),
});

// La reception d'une commande fournisseur est identique pour une pharmacie et
// pour le magasin central : le schema est partage (une seule source de verite,
// numero de facture, montant et mode de reglement compris).
export { schemaReception as schemaReceptionMagasin } from '../commandes/commandes.schema.js';