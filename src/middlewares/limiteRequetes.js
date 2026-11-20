
// Limitation de débit (anti force brute / anti déni de service).
//
// Le comptage se fait par UTILISATEUR (identifiant du jeton) et non par adresse
// IP : avec 500 à 1000 utilisateurs derrière un même NAT ou un proxy
// d'entreprise, une limite par IP bloquerait tout le monde en quelques
// secondes. L'adresse IP reste la clé de repli (requête non authentifiée).
//
//  - limiteurGeneral   : appliqué à toute l'API
//  - limiteurConnexion : plus strict, indexé par e-mail + IP (les tentatives
//                        réussies ne sont pas comptées)

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/env.js';
import { verifierJetonAcces } from '../utils/jetons.js';

/** Clé de comptage : utilisateur du jeton, sinon adresse IP. */
export function cleComptage(req) {
  const entete = req.headers.authorization ?? '';
  if (entete.startsWith('Bearer ')) {
    try {
      const charge = verifierJetonAcces(entete.slice(7).trim());
      if (charge?.sub) return `utilisateur:${charge.sub}`;
    } catch {
      // Jeton invalide ou expiré : repli sur l'adresse IP
    }
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
}

/** Clé de comptage des tentatives de connexion : e-mail + adresse IP. */
function cleConnexion(req) {
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase();
  return `connexion:${email || 'anonyme'}|${ipKeyGenerator(req.ip)}`;
}

const messageTropDeRequetes = {
  succes: false,
  erreur: {
    code: 'TROP_DE_REQUETES',
    message: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
  },
};

// En cluster, chaque processus tient son propre compteur : la limite configurée
// est donc répartie sur le nombre de processus, afin que la limite GLOBALE reste
// celle annoncée dans .env (au lieu d'être multipliée par le nombre de workers).
const processus = Math.max(1, config.cluster.workers);
const limiteParProcessus = Math.max(50, Math.ceil(config.securite.maxRequetes / processus));
const limiteConnexionsParProcessus = Math.max(5, Math.ceil(config.securite.maxConnexions / processus));

export const limiteurGeneral = rateLimit({
  windowMs: config.securite.fenetreLimiteMinutes * 60 * 1000,
  limit: limiteParProcessus,
  keyGenerator: cleComptage,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: messageTropDeRequetes,
});

export const limiteurConnexion = rateLimit({
  windowMs: config.securite.fenetreLimiteMinutes * 60 * 1000,
  limit: limiteConnexionsParProcessus,
  keyGenerator: cleConnexion,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    succes: false,
    erreur: {
      code: 'TROP_DE_TENTATIVES',
      message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
    },
  },
});

/** État de la configuration des limiteurs (supervision). */
export const statistiquesLimiteurs = () => ({
  cle: 'utilisateur (jeton) avec repli sur l’adresse IP',
  fenetreMinutes: config.securite.fenetreLimiteMinutes,
  processus,
  maximumGlobalParUtilisateur: config.securite.maxRequetes,
  maximumParProcessus: limiteParProcessus,
  maximumTentativesConnexion: config.securite.maxConnexions,
});
