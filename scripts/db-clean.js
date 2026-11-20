// Purge des données de la base en conservant UNIQUEMENT le compte super
// administrateur (et les données de référence indispensables au démarrage).
//
// Usage (depuis backend/) :
//   npm run db:clean                        -> purge standard
//   npm run db:clean:simulation             -> affiche le détail SANS rien supprimer
//   npm run db:clean:referentiels           -> vide aussi les référentiels métier
//   npm run db:clean -- --force             -> autorise la purge en production
//
//   (équivalent direct, si des options supplémentaires sont nécessaires :)
//   node scripts/db-clean.js --simulation --avec-referentiels
//
// Note : selon la version de npm, `npm run db:clean -- --option` peut avaler
// l'option (« npm warn Unknown cli config »). Les scripts db:clean:* ci-dessus
// évitent ce piège ; sinon, appeler directement node scripts/db-clean.js.
//
// TOUJOURS CONSERVÉ :
//   departements, roles, permissions, roles_permissions, parametres,
//   pharmacie_referentiels (catégories / unités de mesure) et le(s) compte(s)
//   super administrateur avec ses rôles et ses départements.
//
// SUPPRIMÉ :
//   toutes les données métier (ventes, retours, stocks, lots, inventaires,
//   commandes, clients, finances), le journal d'audit, les jetons de session
//   et tous les comptes autres que le super administrateur.
//
// Avec --avec-referentiels, sont également vidés : pharmacie_points,
// pharmacie_produits, pharmacie_produits_points, pharmacie_fournisseurs,
// finance_services et finance_comptes.

import pg from 'pg';
import { config } from '../src/config/env.js';

const argumentsCli = process.argv.slice(2);
const simulation = argumentsCli.includes('--simulation');
const avecReferentiels = argumentsCli.includes('--avec-referentiels');
const force = argumentsCli.includes('--force');

// Tables vidées dans tous les cas : données opérationnelles + sécurité.
const TABLES_METIER = [
  // Pharmacie : retours, ventes, caisses, inventaires, achats, stocks, clients
  'pharmacie_retours_ventes_lignes',
  'pharmacie_retours_ventes',
  'pharmacie_paiements',
  'pharmacie_ventes_lignes',
  'pharmacie_ventes',
  'pharmacie_caisses',
  'pharmacie_inventaires_lignes',
  'pharmacie_inventaires',
  'pharmacie_receptions',
  'pharmacie_commandes_lignes',
  'pharmacie_commandes',
  'pharmacie_mouvements_stock',
  'pharmacie_lots',
  'pharmacie_clients',
  // Finances
  'finance_echeances_rappels',
  'finance_echeances',
  'finance_depenses',
  'finance_transactions',
  // IAM : sessions et traçabilité
  'journal_audit',
  'jetons_rafraichissement',
  'jetons_reinitialisation',
];

// Référentiels métier : vidés uniquement sur demande explicite.
const TABLES_REFERENTIELS = [
  'pharmacie_produits_points',
  'pharmacie_produits',
  'pharmacie_fournisseurs',
  'finance_comptes',
  'finance_services',
  'pharmacie_points',
];

const TABLES_A_VIDER = [
  ...TABLES_METIER,
  ...(avecReferentiels ? TABLES_REFERENTIELS : []),
];

// Compteurs affichés après la purge (contrôle rapide).
const TABLES_DE_CONTROLE = [
  'utilisateurs',
  'departements',
  'roles',
  'permissions',
  'parametres',
  'pharmacie_referentiels',
  'pharmacie_points',
  'pharmacie_produits',
  'pharmacie_ventes',
];

function formaterLignes(nombre) {
  return `${nombre} ligne(s)`;
}

// Liste les tables réellement présentes en base (tolère un schéma ancien).
async function tablesExistantes(client, tables) {
  const { rows } = await client.query(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND c.relname = ANY ($1::text[])`,
    [tables]
  );
  return new Set(rows.map((ligne) => ligne.relname));
}

async function compter(client, table) {
  const { rows } = await client.query(`SELECT count(*)::int AS total FROM ${table}`);
  return rows[0].total;
}
async function executer() {
  if (config.estProduction && !force && !simulation) {
    console.error(
      '\n❌ Purge refusée : NODE_ENV=production. Ajoutez --force si vous êtes certain de vouloir vider cette base.\n'
    );
    process.exitCode = 1;
    return;
  }

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
    `\n🧹 Purge de la base : ${config.baseDeDonnees.database}@${config.baseDeDonnees.host}:${config.baseDeDonnees.port}`
  );
  console.log(
    `   Mode : ${simulation ? 'SIMULATION (aucune suppression)' : 'RÉEL'}${
      avecReferentiels ? ' + référentiels métier' : ''
    }\n`
  );

  try {
    await client.query('BEGIN');

    // 1) Le compte à conserver : le(s) compte(s) super administrateur.
    const { rows: superAdmins } = await client.query(
      `SELECT id, matricule, email, nom, prenom
         FROM utilisateurs
        WHERE super_admin = TRUE
        ORDER BY created_at`
    );

    if (superAdmins.length === 0) {
      await client.query('ROLLBACK');
      console.error(
        '❌ Aucun compte super administrateur (utilisateurs.super_admin = TRUE) : purge annulée pour ne pas vous verrouiller hors de la plateforme.\n'
      );
      process.exitCode = 1;
      return;
    }

    const { rows: autresComptes } = await client.query(
      `SELECT count(*)::int AS total FROM utilisateurs WHERE super_admin = FALSE`
    );

    // 2) Contenu avant purge (uniquement les tables présentes en base).
    const existantes = await tablesExistantes(client, TABLES_A_VIDER);
    const aVider = TABLES_A_VIDER.filter((table) => existantes.has(table));

    if (aVider.length !== TABLES_A_VIDER.length) {
      const absentes = TABLES_A_VIDER.filter((table) => !existantes.has(table));
      console.log("   Tables absentes ignorees : " + absentes.join(", ") + "\n");
    }

    console.log('🗑️  Données supprimées :');
    for (const table of aVider) {
      console.log(`   ${table.padEnd(34, '.')} ${formaterLignes(await compter(client, table))}`);
    }

    console.log('\n👤 Compte(s) conservé(s) :');
    for (const compte of superAdmins) {
      console.log(`   ${compte.email} (${compte.matricule}) - ${compte.prenom} ${compte.nom}`);
    }
    console.log(`   ${formaterLignes(autresComptes[0].total)} de compte(s) à supprimer\n`);

    // 3) Vidage. TRUNCATE ... CASCADE est plus rapide qu'un DELETE et remet les
    //    séquences à zéro. Aucune table conservée ne référence ces tables : la
    //    cascade ne touche donc que des données déjà listées ci-dessus.
    await client.query(`TRUNCATE TABLE ${aVider.join(', ')} RESTART IDENTITY CASCADE`);

    // 4) Suppression de tous les autres comptes (jetons, rôles et départements
    //    associés suivent via ON DELETE CASCADE / SET NULL).
    const suppression = await client.query('DELETE FROM utilisateurs WHERE super_admin = FALSE');

    if (simulation) {
      await client.query('ROLLBACK');
      console.log('🔎 Simulation terminée : aucune donnée n’a été supprimée (ROLLBACK).\n');
      return;
    }

    await client.query('COMMIT');

    // 5) Contrôle après purge.
    const presentes = await tablesExistantes(client, TABLES_DE_CONTROLE);
    console.log('✅ Purge terminée.');
    console.log(`   Comptes supprimés : ${suppression.rowCount}`);
    console.log('\n📊 Contrôle après purge :');
    for (const table of TABLES_DE_CONTROLE.filter((table) => presentes.has(table))) {
      console.log(`   ${table.padEnd(34, '.')} ${await compter(client, table)}`);
    }
    console.log('\n💡 Le compte super administrateur se connecte avec son mot de passe habituel.\n');
  } catch (erreur) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Échec de la purge :', erreur.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

executer();
