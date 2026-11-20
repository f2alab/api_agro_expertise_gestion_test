
// Bus d'événements temps réel.
//
// Une seule connexion PostgreSQL dédiée écoute le canal « gae_evenements »
// (LISTEN) et rediffuse chaque changement aux flux SSE ouverts. Cette
// connexion reste volontairement HORS du pool applicatif : elle vit aussi
// longtemps que le serveur et ne doit jamais être rendue au pool.
//
// Robustesse production :
//   * reconnexion automatique avec attente croissante (1 s → 30 s) et jitter ;
//   * les abonnés en erreur n'interrompent jamais la diffusion ;
//   * un canal absent ou une base injoignable ne bloque pas le démarrage de
//     l'API : le temps réel est simplement indisponible et se rétablit seul.

import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normaliserEvenement } from './evenements.js';

const { Client } = pg;

/** Nom de canal PostgreSQL valide (protection contre l'injection SQL). */
const CANAL_VALIDE = /^[A-Za-z_][A-Za-z0-9_.$]{0,62}$/;

const abonnes = new Set();

let client = null;
let ecouteActive = false;
let arretDemande = false;
let tentatives = 0;
let derniereErreur = null;
let minuterie = null;

function optionsConnexion() {
  return {
    host: config.baseDeDonnees.host,
    port: config.baseDeDonnees.port,
    database: config.baseDeDonnees.database,
    user: config.baseDeDonnees.user,
    password: config.baseDeDonnees.password,
    ssl: config.baseDeDonnees.ssl,
    application_name: 'gae-erp-temps-reel',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
}

/** Abonne un consommateur (flux SSE). Renvoie la fonction de désabonnement. */
export function abonner(callback) {
  abonnes.add(callback);
  return () => abonnes.delete(callback);
}

export const nombreAbonnes = () => abonnes.size;

/** Diffuse un événement déjà normalisé à tous les abonnés. */
function diffuser(evenement) {
  for (const abonne of [...abonnes]) {
    try {
      abonne(evenement);
    } catch (erreur) {
      logger.warn('Abonné temps réel en erreur', erreur.message);
    }
  }
}

/**
 * Publie un événement depuis l'application (utile pour les changements qui
 * ne proviennent pas d'une table, par exemple une déconnexion de masse).
 */
export function publier(evenement) {
  const propre = normaliserEvenement(evenement);
  if (propre) diffuser(propre);
}

/** État du bus (supervision / route d'état). */
export const etatBus = () => ({
  actif: ecouteActive,
  canal: config.tempsReel.canal,
  abonnes: abonnes.size,
  tentatives,
  derniereErreur,
});

/** Ferme la connexion d'écoute sans planifier de reconnexion. */
async function fermerClient() {
  const connexion = client;
  client = null;
  ecouteActive = false;
  if (!connexion) return;

  try {
    // Retire les écouteurs : la fermeture demandée ne doit pas relancer le cycle
    connexion.removeAllListeners();
    await connexion.end();
  } catch (erreur) {
    logger.warn('Fermeture de la connexion temps réel impossible', erreur.message);
  }
}

/** Planifie une reconnexion avec attente croissante (1 s → 30 s). */
function planifierReconnexion(motif) {
  if (arretDemande || minuterie) return;

  ecouteActive = false;
  derniereErreur = motif ?? derniereErreur;
  tentatives += 1;

  const base = Math.min(1000 * 2 ** (tentatives - 1), 30_000);
  const delai = base + Math.floor(Math.random() * 500);

  logger.warn(
    `Temps réel : écoute interrompue (${derniereErreur ?? 'raison inconnue'}). ` +
      `Nouvelle tentative dans ${Math.round(delai / 1000)} s.`
  );

  minuterie = setTimeout(() => {
    minuterie = null;
    void connecter().catch(() => planifierReconnexion('connexion impossible'));
  }, delai);

  minuterie.unref?.();
}

/** Ouvre la connexion d'écoute et s'abonne au canal. */
async function connecter() {
  if (arretDemande || client) return ecouteActive;

  const canal = config.tempsReel.canal;
  if (!CANAL_VALIDE.test(canal)) {
    logger.error(`Temps réel : nom de canal invalide (« ${canal} »), écoute annulée.`);
    arretDemande = true;
    return false;
  }

  const connexion = new Client(optionsConnexion());
  client = connexion;

  connexion.on('notification', (message) => {
    if (message.channel !== canal || !message.payload) return;
    try {
      const evenement = normaliserEvenement(JSON.parse(message.payload));
      if (evenement) diffuser(evenement);
    } catch (erreur) {
      logger.warn('Événement temps réel illisible', erreur.message);
    }
  });

  connexion.on('error', (erreur) => {
    if (client !== connexion) return;
    logger.warn('Erreur sur la connexion temps réel', erreur.message);
    void fermerClient().then(() => planifierReconnexion(erreur.message));
  });

  connexion.on('end', () => {
    if (client !== connexion) return;
    void fermerClient().then(() => planifierReconnexion('connexion fermée par le serveur'));
  });

  try {
    await connexion.connect();
    await connexion.query(`LISTEN "${canal}"`);

    ecouteActive = true;
    tentatives = 0;
    derniereErreur = null;
    logger.info(`Temps réel : écoute du canal PostgreSQL « ${canal} » active.`);
    return true;
  } catch (erreur) {
    derniereErreur = erreur.message;
    await fermerClient();
    throw erreur;
  }
}

/**
 * Démarre l'écoute du canal. Ne lève jamais d'exception : en cas d'échec,
 * une reconnexion est planifiée et l'API continue de fonctionner.
 */
export async function demarrerBus() {
  if (!config.tempsReel.actif) {
    logger.info('Temps réel désactivé (TEMPS_REEL_ACTIF=false).');
    return false;
  }

  arretDemande = false;
  try {
    return await connecter();
  } catch (erreur) {
    planifierReconnexion(erreur.message);
    return false;
  }
}

/** Arrête proprement l'écoute (arrêt du serveur). */
export async function arreterBus() {
  arretDemande = true;
  if (minuterie) {
    clearTimeout(minuterie);
    minuterie = null;
  }
  await fermerClient();
}
