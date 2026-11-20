
// Schémas de validation du module Authentification.

import { z } from 'zod';
import { schemaMotDePasse } from '../../utils/validations.js';

export { schemaMotDePasse };

export const schemaConnexion = z.object({
  email: z.string().email('Adresse e-mail invalide.').max(180),
  motDePasse: z.string().min(1, 'Le mot de passe est requis.').max(128),
});

export const schemaRafraichissement = z.object({
  jetonRafraichissement: z.string().min(32, 'Jeton de rafraîchissement invalide.'),
});

export const schemaDeconnexion = schemaRafraichissement;

export const schemaChangementMotDePasse = z.object({
  ancienMotDePasse: z.string().min(1, "L'ancien mot de passe est requis."),
  nouveauMotDePasse: schemaMotDePasse,
});

export const schemaDemandeReinitialisation = z.object({
  email: z.string().email('Adresse e-mail invalide.').max(180),
});

export const schemaReinitialisation = z.object({
  jeton: z.string().min(32, 'Jeton de réinitialisation invalide.'),
  nouveauMotDePasse: schemaMotDePasse,
});