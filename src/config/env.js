
// Configuration centralisée de l'application.
// Toutes les variables d'environnement sont validées au démarrage : en cas
// d'oubli, le serveur s'arrête immédiatement avec un message explicite.

import 'dotenv/config';
import { z } from 'zod';
import { coeursDisponibles, resoudreThreadsHachage, resoudreWorkers } from './parallelisme.js';

// Schéma de validation des variables d'environnement
const schemaEnvironnement = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default('GAE ERP - Module IAM'),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('gae_gestiondb'),
  DB_USER: z.string().default('Geek'),
  DB_PASSWORD: z.string().default('123456'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_SSL: z.enum(['true', 'false']).default('false').transform((valeur) => valeur === 'true'),

  // Hôte dédié à l'écoute du canal temps réel (LISTEN/NOTIFY). Indispensable
  // dès que l'API passe par un pooler de connexions (Neon « -pooler »,
  // PgBouncer en mode transaction) : un pooler n'y relate JAMAIS les
  // notifications. Par défaut, on retombe sur DB_HOST, puis sur PGHOST_UNPOOLED
  // (variable fournie par Neon pour la connexion directe).
  DB_HOST_TEMPS_REEL: z.string().optional(),
  PGHOST_UNPOOLED: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET doit contenir au moins 32 caractères'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET doit contenir au moins 32 caractères'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  HACHAGE_WORKERS: z
    .union([z.literal('auto'), z.coerce.number().int().min(0).max(16)])
    .default('auto'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2000),
  RATE_LIMIT_CONNEXION_MAX: z.coerce.number().int().positive().default(20),
  CACHE_AUTH_SECONDES: z.coerce.number().int().min(0).max(60).default(5),
  CACHE_REPONSE_SECONDES: z.coerce.number().int().min(0).max(300).default(20),
  CLUSTER_WORKERS: z
    .union([z.literal('auto'), z.coerce.number().int().min(0).max(32)])
    .default('auto'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // --- Temps réel (notification des changements par SSE) ----------------------
  TEMPS_REEL_ACTIF: z.enum(['true', 'false']).default('true').transform((valeur) => valeur === 'true'),
  TEMPS_REEL_PING_SECONDES: z.coerce.number().int().positive().default(20),
  TEMPS_REEL_DUREE_MAX_MINUTES: z.coerce.number().int().positive().default(60),
  TEMPS_REEL_REVALIDATION_SECONDES: z.coerce.number().int().positive().default(300),
  TEMPS_REEL_FLUX_MAX_PAR_UTILISATEUR: z.coerce.number().int().positive().default(5),
  TEMPS_REEL_FLUX_MAX_TOTAL: z.coerce.number().int().positive().default(5000),
  // Plafond d'événements diffusés par seconde et par flux : au-delà, le flux
  // reçoit une demande de resynchronisation (1 rechargement au lieu d'une salve).
  TEMPS_REEL_EVENEMENTS_PAR_SECONDE: z.coerce.number().int().positive().default(25),
});

const resultat = schemaEnvironnement.safeParse(process.env);

if (!resultat.success) {
  console.error('❌ Configuration invalide (.env) :');
  for (const probleme of resultat.error.issues) {
    console.error(`   - ${probleme.path.join('.')} : ${probleme.message}`);
  }
  process.exit(1);
}

const brut = resultat.data;

/**
 * Détecte un hôte de pooler de connexions (Neon « -pooler », PgBouncer...).
 * Un tel hôte est parfaitement valide pour les requêtes, mais rend
 * `LISTEN/NOTIFY` inopérant : le temps réel ne recevrait donc jamais rien.
 * @param {string} hote
 */
export const estHotePooler = (hote) => /-pooler\./i.test(String(hote ?? ''));

// Objet de configuration exposé au reste de l'application (immuable)
export const config = Object.freeze({
  environnement: brut.NODE_ENV,
  estProduction: brut.NODE_ENV === 'production',
  port: brut.PORT,
  nomApplication: brut.APP_NAME,
  baseDeDonnees: {
    host: brut.DB_HOST,
    // Connexion dédiée au LISTEN/NOTIFY : jamais via un pooler (voir plus haut).
    hostTempsReel: brut.DB_HOST_TEMPS_REEL ?? brut.PGHOST_UNPOOLED ?? brut.DB_HOST,
    port: brut.DB_PORT,
    database: brut.DB_NAME,
    user: brut.DB_USER,
    password: brut.DB_PASSWORD,
    max: brut.DB_POOL_MAX,
    ssl: brut.DB_SSL ? { rejectUnauthorized: false } : false,
  },
  jwt: {
    secretAcces: brut.JWT_ACCESS_SECRET,
    secretRafraichissement: brut.JWT_REFRESH_SECRET,
    dureeAcces: brut.JWT_ACCESS_EXPIRES,
    dureeRafraichissementJours: brut.JWT_REFRESH_EXPIRES_DAYS,
    emetteur: 'gae-erp',
    audience: 'gae-erp-client',
  },
  securite: {
    coutBcrypt: brut.BCRYPT_ROUNDS,
    hachageWorkers: resoudreThreadsHachage(brut.HACHAGE_WORKERS, brut.NODE_ENV === 'production'),
    coeurs: coeursDisponibles,
    maxTentatives: brut.LOGIN_MAX_ATTEMPTS,
    dureeVerrouMinutes: brut.LOGIN_LOCK_MINUTES,
    fenetreLimiteMinutes: brut.RATE_LIMIT_WINDOW_MINUTES,
    maxRequetes: brut.RATE_LIMIT_MAX,
    maxConnexions: brut.RATE_LIMIT_CONNEXION_MAX,
    cacheAuthSecondes: brut.CACHE_AUTH_SECONDES,
    cacheReponseSecondes: brut.CACHE_REPONSE_SECONDES,
  },
  cluster: {
    workers: resoudreWorkers(brut.CLUSTER_WORKERS, brut.NODE_ENV === 'production'),
    configuration: brut.CLUSTER_WORKERS,
  },
  cors: {
    origines: brut.CORS_ORIGINS.split(',').map((origine) => origine.trim()).filter(Boolean),
  },
  tempsReel: {
    actif: brut.TEMPS_REEL_ACTIF,
    pingSecondes: brut.TEMPS_REEL_PING_SECONDES,
    dureeMaxMinutes: brut.TEMPS_REEL_DUREE_MAX_MINUTES,
    revalidationSecondes: brut.TEMPS_REEL_REVALIDATION_SECONDES,
    fluxMaxParUtilisateur: brut.TEMPS_REEL_FLUX_MAX_PAR_UTILISATEUR,
    fluxMaxTotal: brut.TEMPS_REEL_FLUX_MAX_TOTAL,
    evenementsParSeconde: brut.TEMPS_REEL_EVENEMENTS_PAR_SECONDE,
    canal: 'gae_evenements',
  },
});
