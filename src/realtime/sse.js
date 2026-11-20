
// Flux temps réel (Server-Sent Events) : canal serveur -> navigateur.
//
// Un flux = une requête HTTP gardée ouverte. Le serveur y écrit :
//   * « pret »              : accusé de réception initial (types autorisés) ;
//   * « evenement »         : un changement de données (identifiants seuls) ;
//   * « resynchronisation » : les droits ont changé, recharger les écrans ;
//   * « deconnexion »       : le compte n'est plus actif, le flux se ferme ;
//   * « fin »               : fermeture volontaire (durée max, arrêt serveur).
//
// Garde-fous production :
//   * filtre par permission : un utilisateur ne reçoit que les types de
//     changements qu'il a le droit de consulter (voir evenements.js) ;
//   * quota de flux simultanés par utilisateur (onglets) ;
//   * ping périodique pour traverser proxys et pare-feux ;
//   * durée maximale : le client est reconduit vers une connexion neuve ;
//   * revalidation du compte (statut + permissions) pendant la connexion ;
//   * les erreurs de base pendant une revalidation ne coupent pas les flux.

import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { chargerProfil } from '../modules/auth/session.service.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';
import { abonner } from './bus.js';
import { listeTypes, typesAutorises } from './evenements.js';

/** Conseille au navigateur un délai de reconnexion (ms). */
const DELAI_RETRY_MS = 3000;

/**
 * Données non absorbées par un client avant fermeture du flux (octets).
 * Un client qui ne lit plus (onglet gelé, réseau très lent) ferait gonfler la
 * mémoire du serveur : au-delà de ce seuil, son flux est fermé et il se
 * reconnectera de lui-même. C'est ce qui permet d'ouvrir des milliers de flux
 * sans risque pour la mémoire.
 */
const PRESSION_MAX = 1_000_000;

/**
 * Fenêtre de déduplication par entité (ms).
 *
 * Si la même entité change plusieurs fois en moins d'une demi-seconde, un seul
 * événement est diffusé : les écrans relisent de toute façon l'état COURANT via
 * l'API (le flux notifie, le client revalide). Sans cela, 10 modifications d'une
 * même fiche en 1 seconde seraient diffusées 10 fois à chacun des milliers de
 * flux connectés - c'est le principal coût CPU du temps réel en forte charge.
 */
const FENETRE_DEDUPLICATION = 500;

/** Flux actuellement ouverts. */
const flux = new Set();

let desabonnerBus = null;
let evenementsDiffuses = 0;
let resynchronisations = 0;
let evenementsIgnores = 0;

/** Compte les flux ouverts pour un utilisateur donné. */
function compterFluxUtilisateur(utilisateurId) {
  let total = 0;
  for (const courant of flux) if (courant.utilisateurId === utilisateurId) total += 1;
  return total;
}

/** Écrit une trame brute dans un flux (renvoie false si l'écriture a échoué). */
function ecrire(courant, trame) {
  if (courant.ferme || courant.res.writableEnded) return false;
  try {
    courant.res.write(trame);

    // Protection mémoire : un client qui n'absorbe plus les données est
    // déconnecté plutôt que de laisser le tampon grossir indéfiniment.
    if (courant.res.writableLength > PRESSION_MAX) {
      fermerFlux(courant, 'client trop lent (tampon plein)');
      return false;
    }

    return true;
  } catch (erreur) {
    fermerFlux(courant, `écriture impossible (${erreur.message})`);
    return false;
  }
}

/** Envoie un événement nommé au format SSE. */
function envoyer(courant, { id = null, evenement = null, donnees = null } = {}) {
  let trame = '';
  if (id) trame += `id: ${id}\n`;
  if (evenement) trame += `event: ${evenement}\n`;
  trame += `data: ${JSON.stringify(donnees)}\n\n`;
  return ecrire(courant, trame);
}

/** Ferme un flux et libère ses minuteurs (idempotent). */
function fermerFlux(courant, raison = 'fermeture') {
  if (courant.ferme) return;
  courant.ferme = true;

  clearInterval(courant.minuteurPing);
  clearTimeout(courant.minuteurDuree);
  clearInterval(courant.minuteurRevalidation);
  flux.delete(courant);

  try {
    courant.res.end();
  } catch {
    // Connexion déjà fermée par le client : rien à faire
  }

  logger.info(`Temps réel : flux fermé (${courant.email}, ${raison}) - ${flux.size} flux actif(s).`);
}

/** Rediffuse un événement du bus vers les flux autorisés. */
function diffuserAuxFlux(evenement) {
  evenementsDiffuses += 1;

  const plafond = config.tempsReel.evenementsParSeconde;
  const maintenant = Date.now();

  for (const courant of [...flux]) {
    if (!courant.types.has(evenement.type)) continue;

    // Périmètre : un compte cloisonné ne reçoit pas les événements d'une autre
    // pharmacie (les événements sans point - ex. produits - restent diffusés).
    if (!courant.porteeGlobale && evenement.pointId && evenement.pointId !== courant.pointVenteId) {
      continue;
    }

    // Fenêtre glissante d'une seconde, par flux
    if (maintenant - courant.debutFenetre >= 1000) {
      courant.debutFenetre = maintenant;
      courant.evenementsFenetre = 0;
    }

    // Déduplication par entité : une même fiche modifiée plusieurs fois en
    // moins de FENETRE_DEDUPLICATION ne génère qu'un seul événement par flux.
    const clefDeduplication = evenement.entiteId ? `${evenement.type}:${evenement.entiteId}` : null;

    if (clefDeduplication) {
      const dernier = courant.recentes.get(clefDeduplication);
      if (dernier !== undefined && maintenant - dernier < FENETRE_DEDUPLICATION) {
        evenementsIgnores += 1;
        continue;
      }
      courant.recentes.set(clefDeduplication, maintenant);
    }

    // Purge périodique de la table de déduplication du flux
    if (maintenant - courant.dernierePurge >= FENETRE_DEDUPLICATION) {
      for (const [clef, horodatage] of courant.recentes) {
        if (maintenant - horodatage >= FENETRE_DEDUPLICATION) courant.recentes.delete(clef);
      }
      courant.dernierePurge = maintenant;
    }

    // Trop d'événements pour ce flux : on lui demande de resynchroniser ses
    // écrans. Un rechargement coûte bien moins cher que la diffusion d'une
    // salve (cas typique : un module très actif écouté par des milliers de
    // flux). Les écrans revalident systématiquement leurs données, la
    // resynchronisation est donc sans perte d'information.
    if (courant.evenementsFenetre >= plafond) {
      if (maintenant - courant.derniereResynchronisation >= 1000) {
        courant.derniereResynchronisation = maintenant;
        resynchronisations += 1;
        envoyer(courant, { evenement: 'resynchronisation', donnees: { motif: 'FORTE_ACTIVITE' } });
      }
      continue;
    }

    courant.evenementsFenetre += 1;
    courant.nbEvenements += 1;
    envoyer(courant, { id: evenement.id, evenement: 'evenement', donnees: evenement });
  }
}

/** Un seul abonnement au bus pour tous les flux. */
function assurerAbonnementBus() {
  if (!desabonnerBus) desabonnerBus = abonner(diffuserAuxFlux);
}

/**
 * Revalide le compte et ses permissions pendant que le flux est ouvert.
 * Toute panne de base est ignorée : le flux reste ouvert.
 */
async function revalider(courant) {
  if (courant.ferme) return;

  try {
    // Passe par le cache de profils partagé avec l'authentification : sur un
    // millier de flux, cela représente quelques requêtes SQL au lieu de 2000.
    const profil = await chargerProfil(courant.utilisateurId);

    if (!profil || profil.statut !== 'ACTIF') {
      envoyer(courant, { evenement: 'deconnexion', donnees: { motif: 'COMPTE_INACTIF' } });
      fermerFlux(courant, 'compte inactif');
      return;
    }

    const types = typesAutorises({ superAdmin: profil.superAdmin, permissions: profil.permissions });

    const modifie = types.size !== courant.types.size || [...types].some((type) => !courant.types.has(type));

    courant.superAdmin = Boolean(profil.superAdmin);
    courant.permissions = profil.permissions;
    courant.types = types;
    courant.porteeGlobale = Boolean(profil.superAdmin || profil.porteeGlobale);
    courant.pointVenteId = profil.pointVenteId ?? null;

    if (modifie) {
      envoyer(courant, {
        evenement: 'resynchronisation',
        donnees: { motif: 'PERMISSIONS_MODIFIEES', types: [...types] },
      });
    }
  } catch (erreur) {
    logger.warn('Temps réel : revalidation impossible', erreur.message);
  }
}

/** Installe les minuteurs d'un flux (ping, durée de vie, revalidation). */
function demarrerMinuteurs(courant) {
  courant.minuteurPing = setInterval(() => {
    ecrire(courant, `: ping ${Date.now()}\n\n`);
  }, config.tempsReel.pingSecondes * 1000);

  courant.minuteurDuree = setTimeout(() => {
    envoyer(courant, {
      evenement: 'fin',
      donnees: { motif: 'DUREE_MAX_ATTEINTE', reconnexion: true },
    });
    fermerFlux(courant, 'durée maximale atteinte');
  }, config.tempsReel.dureeMaxMinutes * 60 * 1000);

  courant.minuteurRevalidation = setInterval(
    () => void revalider(courant),
    config.tempsReel.revalidationSecondes * 1000
  );
}

/**
 * Ouvre un flux SSE pour l'utilisateur authentifié.
 * Lève une ApiError si le temps réel est indisponible ou si le quota est atteint.
 */
export function ouvrirFlux(req, res, utilisateur) {
  if (!config.tempsReel.actif) {
    throw new ApiError(503, 'Le temps réel est désactivé sur ce serveur.', 'TEMPS_REEL_INACTIF');
  }

  // Plafond global : borne la mémoire du serveur même en cas d'usage anormal
  if (flux.size >= config.tempsReel.fluxMaxTotal) {
    throw new ApiError(
      503,
      "Limite de connexions temps réel atteinte sur ce serveur. Réessayez dans quelques instants.",
      'TEMPS_REEL_SATURE'
    );
  }

  // Dernier garde-fou : si le processus approche de la saturation mémoire, on
  // refuse d'ouvrir de nouveaux flux (les écrans se reconnecteront).
  const memoire = process.memoryUsage();
  if (memoire.heapUsed > 512 * 1024 * 1024 && memoire.heapUsed / memoire.heapTotal > 0.92) {
    logger.warn(
      `Temps réel : mémoire sous tension (${Math.round(memoire.heapUsed / 1024 / 1024)} Mo utilisés), flux refusé.`
    );
    throw new ApiError(
      503,
      'Serveur temporairement sous forte charge. Réessayez dans quelques instants.',
      'TEMPS_REEL_SATURE'
    );
  }

  const maximum = config.tempsReel.fluxMaxParUtilisateur;
  if (compterFluxUtilisateur(utilisateur.id) >= maximum) {
    throw new ApiError(429, `Trop de flux temps réel simultanés (maximum ${maximum}).`, 'TROP_DE_FLUX');
  }

  // En-têtes propres à un flux d'événements
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx / proxy : pas de mise en tampon
  res.flushHeaders?.();

  // La connexion reste ouverte : on supprime les délais d'inactivité
  const socket = req.socket;
  socket.setTimeout(0);
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30_000);

  const courant = {
    id: randomUUID(),
    utilisateurId: utilisateur.id,
    email: utilisateur.email,
    superAdmin: Boolean(utilisateur.superAdmin),
    permissions: utilisateur.permissions ?? [],
    types: typesAutorises(utilisateur),
    porteeGlobale: Boolean(utilisateur.superAdmin || utilisateur.porteeGlobale),
    pointVenteId: utilisateur.pointVenteId ?? null,
    req,
    res,
    ouvertLe: new Date().toISOString(),
    nbEvenements: 0,
    debutFenetre: Date.now(),
    evenementsFenetre: 0,
    derniereResynchronisation: 0,
    recentes: new Map(),
    dernierePurge: Date.now(),
    ferme: false,
    minuteurPing: null,
    minuteurDuree: null,
    minuteurRevalidation: null,
  };

  flux.add(courant);
  assurerAbonnementBus();
  demarrerMinuteurs(courant);

  ecrire(courant, `retry: ${DELAI_RETRY_MS}\n: flux temps réel ouvert\n\n`);
  envoyer(courant, {
    evenement: 'pret',
    donnees: {
      identifiant: courant.id,
      horodatage: new Date().toISOString(),
      pingSecondes: config.tempsReel.pingSecondes,
      types: [...courant.types],
    },
  });

  req.on('close', () => fermerFlux(courant, 'client déconnecté'));
  res.on('error', () => fermerFlux(courant, 'erreur de connexion'));

  logger.info(`Temps réel : flux ouvert (${courant.email}) - ${flux.size} flux actif(s).`);
  return courant;
}

/** Ferme tous les flux (arrêt du serveur). */
export function fermerTousLesFlux(raison = 'arrêt du serveur') {
  for (const courant of [...flux]) {
    envoyer(courant, {
      evenement: 'fin',
      donnees: { motif: 'SERVEUR_ARRET', reconnexion: true },
    });
    fermerFlux(courant, raison);
  }
}

/** État des flux (supervision / route d'état). */
export const etatFlux = () => ({
  actif: config.tempsReel.actif,
  ouverts: flux.size,
  utilisateurs: new Set([...flux].map((courant) => courant.utilisateurId)).size,
  evenementsDiffuses,
  resynchronisations,
  evenementsIgnores,
  fenetreDeduplicationMs: FENETRE_DEDUPLICATION,
  evenementsParSeconde: config.tempsReel.evenementsParSeconde,
  pingSecondes: config.tempsReel.pingSecondes,
  dureeMaxMinutes: config.tempsReel.dureeMaxMinutes,
  fluxMaxParUtilisateur: config.tempsReel.fluxMaxParUtilisateur,
  fluxMaxTotal: config.tempsReel.fluxMaxTotal,
  types: listeTypes,
});
