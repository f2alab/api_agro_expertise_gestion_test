
// Schémas de validation du module Utilisateurs.

import { z } from 'zod';
import { TAILLE_MAX_PHOTO_BASE64 } from '../../utils/images.js';
import { schemaMotDePasse, uuid } from '../../utils/validations.js';

const STATUTS = ['ACTIF', 'INACTIF', 'SUSPENDU', 'ARCHIVE'];

/** Création d'un compte utilisateur. */
export const schemaCreationUtilisateur = z.object({
  matricule: z.string().trim().min(3).max(30).optional(),
  nom: z.string().trim().min(2, 'Le nom est requis.').max(80),
  prenom: z.string().trim().min(2, 'Le prénom est requis.').max(80),
  email: z.string().email('Adresse e-mail invalide.').max(180),
  telephone: z.string().trim().max(30).optional().nullable(),
  motDePasse: schemaMotDePasse.optional(),
  departementId: uuid.optional().nullable(),
  /** Pharmacie de rattachement (périmètre d'opération des PPV / techniciens). */
  pointVenteId: uuid.optional().nullable(),
  fonction: z.string().trim().max(120).optional().nullable(),
  statut: z.enum(STATUTS).optional(),
  superAdmin: z.boolean().optional(),
  roleIds: z.array(uuid).max(20).optional(),
});

/** Modification partielle : tous les champs deviennent facultatifs. */
export const schemaModificationUtilisateur = schemaCreationUtilisateur
  .omit({ motDePasse: true })
  .partial()
  .extend({
    // Un champ vide signifie « ne pas changer le mot de passe » (robustesse frontend)
    motDePasse: z.preprocess(
      (valeur) => (typeof valeur === 'string' && valeur.trim() === '' ? undefined : valeur),
      schemaMotDePasse.optional()
    ),
  });

/** Filtres de la liste des utilisateurs. */
export const schemaFiltresUtilisateurs = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  recherche: z.string().trim().max(120).optional(),
  departementId: uuid.optional(),
  roleId: uuid.optional(),
  statut: z.enum(STATUTS).optional(),
});

/** Affectation des rôles d'un utilisateur. */
export const schemaRolesUtilisateur = z.object({
  roleIds: z.array(uuid).max(20),
});

/**
 * Photo de profil : contenu binaire encodé en base64.
 *
 * Seul le contenu est transmis : le type MIME réel, les dimensions et le poids
 * sont déterminés par le serveur à partir des octets reçus (le client ne peut
 * donc pas déclarer des valeurs fantaisistes). Le navigateur recadre l'image
 * en carré et la compresse avant l'envoi ; le serveur vérifie ensuite le
 * format, la résolution (2 000 px maximum par côté) et le poids (512 Ko).
 */
export const schemaPhotoUtilisateur = z.object({
  contenuBase64: z
    .string()
    .min(1, 'La photo est requise.')
    .max(TAILLE_MAX_PHOTO_BASE64, 'La photo est trop volumineuse : 512 Ko maximum.'),
});