
// Jetons de sécurité :
//  - jeton d'accès  : JWT courte durée (envoyé dans l'en-tête Authorization)
//  - jeton de rafraîchissement : chaîne aléatoire opaque, stockée HACHÉE en base
//    (SHA-256) pour qu'une fuite de la base ne permette pas de rejouer les sessions.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/** Signe un jeton d'accès JWT pour un utilisateur. */
export function signerJetonAcces(utilisateur) {
  return jwt.sign(
    {
      sub: utilisateur.id,
      email: utilisateur.email,
      superAdmin: Boolean(utilisateur.superAdmin ?? utilisateur.super_admin),
    },
    config.jwt.secretAcces,
    {
      expiresIn: config.jwt.dureeAcces,
      issuer: config.jwt.emetteur,
      audience: config.jwt.audience,
    }
  );
}

/** Vérifie un jeton d'accès ; lève une erreur si invalide ou expiré. */
export function verifierJetonAcces(jeton) {
  return jwt.verify(jeton, config.jwt.secretAcces, {
    issuer: config.jwt.emetteur,
    audience: config.jwt.audience,
  });
}

/** Génère un jeton opaque (rafraîchissement, réinitialisation). */
export const genererJetonOpaque = () => crypto.randomBytes(48).toString('hex');

/** Empreinte SHA-256 d'un jeton (ce qui est réellement stocké en base). */
export const empreinteJeton = (jeton) => crypto.createHash('sha256').update(jeton).digest('hex');

/** Date d'expiration d'un jeton de rafraîchissement. */
export const dateExpirationRafraichissement = () =>
  new Date(Date.now() + config.jwt.dureeRafraichissementJours * 24 * 60 * 60 * 1000);