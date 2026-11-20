
// Migration de base de données : applique UN script SQL sur une base existante,
// sans réinitialisation (contrairement à `npm run db:setup`, qui recrée tout).
//
// Usage :
//   node scripts/db-migrate.js                      -> sql/13_temps_reel.sql
//   node scripts/db-migrate.js 13_temps_reel.sql    -> script choisi dans sql/
//
// Les scripts du dossier sql/ sont écrits pour être rejouables : les rejouer
// met simplement à jour les fonctions et les triggers concernés.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/env.js';

const dossierCourant = path.dirname(fileURLToPath(import.meta.url));
const dossierSql = path.join(dossierCourant, '..', 'sql');

const fichier = process.argv[2] ?? '13_temps_reel.sql';
const chemin = path.join(dossierSql, path.basename(fichier));

async function executer() {
  const client = new pg.Client({
    host: config.baseDeDonnees.host,
    port: config.baseDeDonnees.port,
    database: config.baseDeDonnees.database,
    user: config.baseDeDonnees.user,
    password: config.baseDeDonnees.password,
    ssl: config.baseDeDonnees.ssl,
  });

  await client.connect();
  console.log(
    `\n📦 Migration « ${path.basename(chemin)} » sur ${config.baseDeDonnees.database}@${config.baseDeDonnees.host}:${config.baseDeDonnees.port}\n`
  );

  try {
    const sql = await fs.readFile(chemin, 'utf8');
    await client.query(sql);

    const { rows } = await client.query(
      `SELECT count(*)::int AS total FROM pg_trigger WHERE tgname LIKE 'trg_temps_reel_%'`
    );

    console.log('✅ Migration appliquée.');
    console.log(`   Fichier : ${path.basename(chemin)}`);
    console.log(`   Nombre total de triggers temps réel en base : ${rows[0].total}\n`);
  } catch (erreur) {
    console.error('\n❌ Échec de la migration :', erreur.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

executer();
