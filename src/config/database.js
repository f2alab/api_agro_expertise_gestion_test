
// Accès PostgreSQL : pool de connexions partagé par toute l'application.
// Aucune requête SQL n'est écrite ici : seuls les utilitaires d'exécution.

import pg from 'pg';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool, types } = pg;

// Les colonnes BIGINT (COUNT(*), BIGSERIAL) sont converties en nombres JS
types.setTypeParser(20, (valeur) => Number(valeur));

export const pool = new Pool({
  host: config.baseDeDonnees.host,
  port: config.baseDeDonnees.port,
  database: config.baseDeDonnees.database,
  user: config.baseDeDonnees.user,
  password: config.baseDeDonnees.password,
  max: config.baseDeDonnees.max,
  ssl: config.baseDeDonnees.ssl,
  application_name: 'gae-erp-api',
  idleTimeoutMillis: 30_000,
  // Une montée en charge (rafales de tableaux de bord) fait patienter les
  // requêtes : 10 s de tolérance évitent les erreurs 500 prématurées.
  connectionTimeoutMillis: 10_000,
  // Garde-fou : une requête lente ne peut plus monopoliser une connexion
  // indéfiniment (protection contre les verrous et les oublis d'index).
  statement_timeout: 15_000,
  query_timeout: 20_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Une erreur sur un client inactif ne doit jamais faire tomber le serveur
pool.on('error', (erreur) => {
  logger.error('Erreur inattendue sur une connexion PostgreSQL inactive', erreur.message);
});

/** Exécute une requête SQL paramétrée ($1, $2, ...). */
export const query = (texte, parametres = []) => pool.query(texte, parametres);

/**
 * Exécute une suite d'instructions dans une transaction.
 * @param {(client: pg.PoolClient) => Promise<any>} callback
 */
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultat = await callback(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  } finally {
    client.release();
  }
}

/** Vérifie que la base est joignable (utilisé au démarrage). */
export async function testerConnexion() {
  const { rows } = await query(
    `SELECT current_database() AS base, current_user AS utilisateur, version() AS version,
            current_setting('max_connections')::int AS max_connexions`
  );
  return rows[0];
}

/**
 * Adapte la taille du pool de connexions au nombre de processus et à la limite
 * `max_connections` de PostgreSQL.
 *
 * Pourquoi : chaque processus ouvre DB_POOL_MAX connexions applicatives **plus**
 * une connexion dédiée à l'écoute du canal temps réel (hors pool). En cluster,
 * le total croît avec le nombre de processus. Sans ce calcul, un démarrage en
 * cluster peut épuiser les connexions PostgreSQL et faire échouer des requêtes.
 *
 * @returns {{ajuste: boolean, taille: number, ancienneTaille?: number, autorise: number, maxConnexions: number}}
 */
export function ajusterTaillePool({ workers = 1, maxConnexions = 100 } = {}) {
  const souhaite = pool.options.max ?? 10;
  const processus = Math.max(1, workers);
  // + 1 connexion d'écoute par processus, + 2 pour les outils d'exploitation
  const reserve = processus + 2;
  const autorise = Math.max(2, Math.floor((maxConnexions - reserve) / processus));

  if (souhaite <= autorise) {
    return { ajuste: false, taille: souhaite, autorise, maxConnexions };
  }

  pool.options.max = autorise;
  return { ajuste: true, taille: autorise, ancienneTaille: souhaite, autorise, maxConnexions };
}

/** Ferme proprement le pool (arrêt du serveur). */
export const fermerPool = () => pool.end();