
// Point d'entrée du serveur API - GAE ERP (module IAM)
//   1. vérifie la connexion PostgreSQL
//   2. démarre l'écoute du canal temps réel (LISTEN/NOTIFY)
//   3. démarre le serveur HTTP
//   4. gère l'arrêt propre (SIGINT / SIGTERM)

import cluster from 'node:cluster';
import os from 'node:os';
import { creerApplication } from './src/app.js';
import { config } from './src/config/env.js';
import { ajusterTaillePool, fermerPool, testerConnexion } from './src/config/database.js';
import { arreterCacheProfils } from './src/modules/auth/session.service.js';
import { arreterBus, demarrerBus } from './src/realtime/bus.js';
import { fermerTousLesFlux } from './src/realtime/sse.js';
import { arreterHachage } from './src/utils/hachage.js';
import { logger } from './src/utils/logger.js';

async function demarrer() {
  const application = creerApplication();

  try {
    const info = await testerConnexion();
    logger.info(`PostgreSQL connecté : base « ${info.base} » (utilisateur ${info.utilisateur})`);

    // Pool dimensionné pour le nombre de processus réellement lancés
    const ajustement = ajusterTaillePool({
      workers: config.cluster.workers,
      maxConnexions: info.max_connexions,
    });

    if (ajustement.ajuste) {
      logger.warn(
        `Pool PostgreSQL réduit de ${ajustement.ancienneTaille} à ${ajustement.taille} connexions par processus ` +
          `(max_connections=${ajustement.maxConnexions}, ${config.cluster.workers} processus). ` +
          'Augmentez max_connections dans postgresql.conf pour plus de débit.'
      );
    } else {
      logger.info(
        `Pool PostgreSQL : ${ajustement.taille} connexions par processus ` +
          `(max_connections=${ajustement.maxConnexions}, ${config.cluster.workers} processus).`
      );
    }
  } catch (erreur) {
    logger.error('Connexion PostgreSQL impossible.', erreur.message);
    logger.error('Vérifiez les variables DB_* du fichier .env et que le serveur est démarré.');
    process.exit(1);
  }

  // Temps réel : l'écoute du canal PostgreSQL ne bloque jamais le démarrage.
  // En cas d'échec, une reconnexion est planifiée automatiquement.
  await demarrerBus();

  // Backlog de 2048 : les rafales de connexions (matin, retour de pause) sont
  // mises en attente par le système au lieu d'être refusées.
  const serveur = application.listen(config.port, 2048, () => {
    logger.info(`${config.nomApplication} démarré ✅`);
    logger.info(
      `Parallélisme : ${os.cpus().length} cœur(s) détecté(s), ${config.cluster.workers} processus, ` +
        `${config.securite.hachageWorkers} thread(s) de hachage.`
    );
    logger.info(`👉 API        : http://localhost:${config.port}/api`);
    logger.info(`👉 Santé      : http://localhost:${config.port}/api/sante`);
    logger.info(`👉 Temps réel : http://localhost:${config.port}/api/temps-reel/flux`);
    logger.info(`👉 Frontend   : http://localhost:5173`);
  });

  // Les flux temps réel (SSE) restent ouverts longtemps : on neutralise le
  // délai maximal de traitement d'une requête. La protection contre les
  // attaques lentes reste assurée par headersTimeout (réception des en-têtes).
  serveur.requestTimeout = 0;
  serveur.headersTimeout = 60_000;

  const arreter = async (signal) => {
    logger.info(`Signal ${signal} reçu : arrêt du serveur...`);

    // 1) prévient et ferme les flux temps réel (le navigateur se reconnectera)
    fermerTousLesFlux('arrêt du serveur');

    // 2) filet de sécurité : force la fermeture des connexions récalcitrantes
    const secours = setTimeout(() => {
      logger.warn('Arrêt : fermeture forcée des connexions restantes.');
      serveur.closeAllConnections?.();
    }, 3000);
    secours.unref?.();

    serveur.close(async () => {
      clearTimeout(secours);
      await arreterBus();
      arreterCacheProfils();
      await arreterHachage();
      await fermerPool();
      logger.info('Serveur arrêté proprement.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => arreter('SIGINT'));
  process.on('SIGTERM', () => arreter('SIGTERM'));
}

// -----------------------------------------------------------------------------
// Mode cluster (production) : un processus de travail par cœur disponible.
//
// Objectif : tenir 500 à 1000 utilisateurs simultanés. Un processus Node
// n'exploite qu'un seul cœur ; le cluster répartit les connexions et
// parallélise les calculs coûteux (hachage bcrypt, sérialisation JSON).
//
// Le temps réel reste correct : chaque worker ouvre sa propre connexion
// `LISTEN` au canal PostgreSQL et reçoit donc tous les événements.
// À noter : le compteur de limitation de débit est en mémoire, donc par worker
// (la limite effective est RATE_LIMIT_MAX × nombre de workers).
// -----------------------------------------------------------------------------
const nombreWorkers = config.cluster.workers;

// Le mode cluster n'a de sens qu'à partir de deux processus : en développement
// (CLUSTER_WORKERS=auto → 1), le serveur démarre directement, sans processus
// intermédiaire inutile.
if (cluster.isPrimary && nombreWorkers > 1) {
  logger.info(`Mode cluster activé : ${nombreWorkers} processus de travail.`);

  // Garde-fou : évite une boucle de redémarrages si un worker plante en boucle
  const redemarrages = [];

  const lancer = () => cluster.fork();
  for (let index = 0; index < nombreWorkers; index += 1) lancer();

  cluster.on('exit', (worker, code, signal) => {
    if (worker.exitedAfterDisconnect) return;

    const maintenant = Date.now();
    redemarrages.push(maintenant);
    while (redemarrages.length > 0 && maintenant - redemarrages[0] > 300_000) redemarrages.shift();

    if (redemarrages.length > 20) {
      logger.error('Trop de redémarrages de processus en 5 minutes : arrêt du serveur.');
      process.exit(1);
    }

    logger.warn(`Processus ${worker.process.pid} arrêté (${signal ?? code}). Redémarrage.`);
    lancer();
  });

  const arreterCluster = (signal) => {
    logger.info(`Signal ${signal} reçu : arrêt des processus de travail...`);
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill(signal);
  };

  process.on('SIGINT', () => arreterCluster('SIGINT'));
  process.on('SIGTERM', () => arreterCluster('SIGTERM'));
} else {
  demarrer();
}