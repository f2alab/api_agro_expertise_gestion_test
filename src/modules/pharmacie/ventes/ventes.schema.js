// Schemas de validation des ventes de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const TYPES_VENTE = ['COMPTOIR', 'ORDONNANCE', 'COMMANDE'];
export const MODES_PAIEMENT = ['ESPECES', 'MOBILE_MONEY', 'CARTE', 'CHEQUE', 'CREDIT', 'VIREMENT'];

const schemaLigneVente = z.object({
  produitId: uuid,
  lotId: uuid.optional().nullable(),
  quantite: z.coerce.number().int().min(1, 'Quantite invalide.'),
  prixUnitaire: z.coerce.number().min(0).optional(),
  remise: z.coerce.number().min(0).optional(),
});

const schemaPaiement = z.object({
  mode: z.enum(MODES_PAIEMENT).optional(),
  montant: z.coerce.number().min(0).optional(),
  /** Compte de paiement mouvemente (mobile money / banque), si connu. */
  compteId: uuid.optional().nullable(),
  reference: z.string().trim().max(80).optional().nullable(),
});

/** Informations completes d'un nouveau client, saisies lors de la vente. */
const schemaClientVente = z.object({
  nom: z.string().trim().min(2, 'Le nom du client est requis.').max(150),
  telephone: z.string().trim().max(30).optional().nullable(),
  email: z.preprocess(
    (valeur) => (typeof valeur === 'string' && valeur.trim() === '' ? null : valeur),
    z.string().email('Adresse e-mail invalide.').max(180).optional().nullable()
  ),
  adresse: z.string().trim().max(200).optional().nullable(),
});

export const schemaCreationVente = z.object({
  pointId: uuid,
  clientId: uuid.optional().nullable(),
  client: schemaClientVente.optional(),
  typeVente: z.enum(TYPES_VENTE).optional(),
  /** Ordonnance de la clinique servie par cette vente (facultatif). */
  ordonnanceId: uuid.optional().nullable(),
  remise: z.coerce.number().min(0).optional(),
  lignes: z.array(schemaLigneVente).min(1, 'Au moins une ligne est requise.'),
  paiement: schemaPaiement.optional(),
  /** Montant remis par le client (monnaie a rendre = recu - encaisse). */
  montantRecu: z.coerce.number().min(0).optional().nullable(),
});

export const schemaPaiementVente = z.object({
  mode: z.enum(MODES_PAIEMENT).optional(),
  montant: z.coerce.number().min(0),
  /** Compte de paiement mouvemente (mobile money / banque), si connu. */
  compteId: uuid.optional().nullable(),
  reference: z.string().trim().max(80).optional().nullable(),
});

export const schemaAnnulationVente = z.object({
  motif: z.string().trim().min(3, 'Le motif est requis.').max(300),
});

/** Retour de produits sur une vente : lignes a retourner + motif facultatif. */
export const schemaCreationRetourVente = z.object({
  motif: z.string().trim().max(300).optional().nullable(),
  lignes: z
    .array(
      z.object({
        ligneId: uuid,
        quantite: z.coerce.number().int().min(1, 'Quantite invalide.'),
      })
    )
    .min(1, 'Au moins une ligne retournee est requise.'),
});

export const schemaFiltresVentes = z.object({
  pointId: uuid.optional(),
  statut: z.enum(['VALIDEE', 'ANNULEE']).optional(),
  /** Etat d'encaissement : SOLDE (payee en totalite) ou CREDIT (reste a payer). */
  statutPaiement: z.enum(['SOLDE', 'CREDIT']).optional(),
  du: z.string().optional(),
  au: z.string().optional(),
  recherche: z.string().trim().max(120).optional(),
  ordre: z.enum(['recent', 'ancien']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Filtres du rapport « produits vendus » (agregation sur une periode). */
export const schemaFiltresProduitsVendus = z.object({
  du: z.string().optional(),
  au: z.string().optional(),
  pointId: uuid.optional(),
  recherche: z.string().trim().max(120).optional(),
  ordre: z.enum(['quantite', 'chiffre_affaires']).optional(),
});