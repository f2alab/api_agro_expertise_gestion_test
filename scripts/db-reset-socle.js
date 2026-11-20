
// =============================================================================
// Réinitialisation « socle » : DÉTRUIT tout, recrée TOUTES les tables, puis ne
// rejoue QUE les données de démarrage du socle IAM :
//
//   * l'organigramme des départements                         (03_seed_organigramme)
//   * le catalogue des permissions, les rôles et leurs liens  (04_seed_permissions_roles)
//   * les comptes de démarrage, dont le super administrateur  (05_seed_utilisateurs)
//   * les paramètres applicatifs par défaut                   (28_parametres)
//
// Aucune donnée métier (ventes, stocks, finances, clinique, magasin...) n'est
// réinsérée : la base repart d'un socle IAM propre, prêt à démarrer.
//
// Usage (depuis backend/) :
//   npm run db:reset:socle                    -> recrée tout + socle IAM
//   npm run db:reset:socle:simulation         -> affiche le résultat SANS rien changer
//   npm run db:reset:socle:admin              -> ne garde QUE le compte super admin
//   node scripts/db-reset-socle.js --force    -> autorise l'opération en production
//
// Tout s'exécute dans UNE SEULE transaction : en cas d'erreur, rien n'est
// modifié (ROLLBACK automatique). En --simulation, la transaction est annulée
// à la fin : la base reste intacte.
//
// ⚠️ DESTRUCTIF : hors --simulation, toutes les données existantes sont perdues.
// =============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/env.js';

const dossierCourant = path.dirname(fileURLToPath(import.meta.url));
const dossierSql = path.join(dossierCourant, '..', 'sql');

// Ordre d'exécution complet (identique à db-setup.js) : le schéma est recréé à
// l'identique, y compris les tables des modules métier (qui resteront vides).
const FICHIERS = [
  '01_schema.sql',
  '02_vues_fonctions.sql',
  '03_seed_organigramme.sql',
  '04_seed_permissions_roles.sql',
  '05_seed_utilisateurs.sql',
  '06_pharmacie_schema.sql',
  '07_pharmacie_vues_fonctions.sql',
  '08_pharmacie_permissions.sql',
  '09_pharmacie_seed.sql',
  '10_pharmacie_clients.sql',
  '11_pharmacie_ventes_restrictions.sql',
  '12_comptable_pharmacie.sql',
  '13_temps_reel.sql',
  '14_performance.sql',
  '15_finances_schema.sql',
  '16_finances_permissions.sql',
  '17_pharmacie_isolation.sql',
  '18_finances_seed.sql',
  '19_temps_reel_finances.sql',
  '20_clients_fournisseurs_isolation.sql',
  '21_referentiels_produits.sql',
  '22_referentiels_suppression_ordre.sql',
  '23_referentiels_codes_rayon_3_chiffres.sql',
  '24_depenses_validation.sql',
  '25_finance_comptes_paiement.sql',
  '26_ventes_credit.sql',
  '27_depenses_datetime.sql',
  '28_parametres.sql',
  '29_retours_ventes.sql',
  '30_suppression_client_denormalise.sql',
  '31_messages_saisonniers.sql',
  '32_lots_peremption.sql',
  '33_produits_forme_optionnels.sql',
  '34_referentiels_formes.sql',
  '35_pharmacie_rapports.sql',
  '36_affichage_discret.sql',
  '37_rapports_depenses_approuvees.sql',
  '38_magasin_central.sql',
  '39_magasin_acces_permission.sql',
  '40_role_resp_magasin.sql',
  '41_pharmacie_reglements.sql',
  '42_reglements_validation.sql',
  '43_validation_depenses_roles.sql',
  '44_finance_apports_comptes.sql',
  '45_utilisateurs_photos.sql',
  '46_finance_echeances.sql',
  '47_clinique_schema.sql',
  '48_clinique_vues_fonctions.sql',
  '49_clinique_permissions.sql',
  '50_clinique_seed.sql',
  '51_clinique_factures_direction.sql',
  '52_clinique_accueil_roles.sql',
  '53_role_accueil_clinique.sql',
  '54_permission_annulation_passage.sql',
  '55_temps_reel_clinique.sql',
  '56_ordonnances_validation.sql',
  '57_roles_veterinaires.sql',
  '58_fournisseurs_principal_succursales.sql',
  '59_ravitaillements_validation.sql',
  '60_ravitaillements_temps_reel.sql',
];

// Données de démarrage du socle IAM, rejouées APRÈS la purge des données.
const SEEDS_SOCLE = [
  '03_seed_organigramme.sql',
  '04_seed_permissions_roles.sql',
  '05_seed_utilisateurs.sql',
  '28_parametres.sql',
];

const argumentsCli = process.argv.slice(2);
const simulation = argumentsCli.includes('--simulation');
const adminSeul = argumentsCli.includes('--admin-seul');
const force = argumentsCli.includes('--force');

// Lit et exécute un script SQL du dossier sql/.
async function executerFichier(client, fichier) {
  const sql = await fs.readFile(path.join(dossierSql, fichier), 'utf8');
  process.stdout.write(`   → ${fichier} ... `);
  await client.query(sql);
  console.log('OK');
}

// Vide toutes les tables du schéma public et remet les séquences à zéro.
// TRUNCATE ... CASCADE est plus rapide qu'un DELETE et règle les clés étrangères.
const PURGE_TOUTES_TABLES = `
  DO $$
  DECLARE nom text;
  BEGIN
    FOR nom IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', nom);
    END LOOP;
  END $$;
`;

async function executer() {
  // Garde-fou : ne jamais écraser une base de production sans --force explicite.
  if (config.estProduction && !force && !simulation) {
    console.error(
      '\n❌ Réinitialisation refusée : NODE_ENV=production. Ajoutez --force si vous êtes certain de vouloir recréer cette base.\n'
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
    `\n🧱 Réinitialisation socle : ${config.baseDeDonnees.database}@${config.baseDeDonnees.host}:${config.baseDeDonnees.port}`
  );
  console.log(
    `   Mode : ${simulation ? 'SIMULATION (ROLLBACK final, aucune modification)' : 'RÉEL'}${
      adminSeul ? ' · compte super admin uniquement' : ''
    }\n`
  );

  try {
    await client.query('BEGIN');

    // 1) Destruction totale + recréation complète du schéma (toutes les tables).
    console.log('1) Destruction et recréation de toutes les tables :');
    await executerFichier(client, '00_reset.sql');
    for (const fichier of FICHIERS) {
      await executerFichier(client, fichier);
    }

    // 2) Purge : toutes les tables sont vidées (données métier ET socle).
    console.log('\n2) Purge de toutes les données :');
    await client.query(PURGE_TOUTES_TABLES);
    console.log('   → toutes les tables vidées (CASCADE, séquences réinitialisées)');

    // 3) Rejeu des seules données de démarrage du socle IAM.
    console.log('\n3) Rejeu des données de démarrage du socle IAM :');
    for (const fichier of SEEDS_SOCLE) {
      await executerFichier(client, fichier);
    }

    if (adminSeul) {
      const { rowCount } = await client.query(
        'DELETE FROM utilisateurs WHERE super_admin = FALSE'
      );
      console.log(
        `   → ${rowCount} compte(s) autre(s) que le super administrateur supprimé(s)`
      );
    }

    // 4) Contrôle : compte rendu du socle reconstitué.
    const { rows } = await client.query(`
      SELECT (SELECT count(*)::int FROM departements)      AS departements,
             (SELECT count(*)::int FROM permissions)       AS permissions,
             (SELECT count(*)::int FROM roles)             AS roles,
             (SELECT count(*)::int FROM roles_permissions) AS liens,
             (SELECT count(*)::int FROM utilisateurs)      AS utilisateurs,
             (SELECT count(*)::int FROM parametres)        AS parametres
    `);
    const compteurs = rows[0];
    console.log('\n📊 Socle IAM reconstitué :');
    console.log(`   Départements      : ${compteurs.departements}`);
    console.log(`   Permissions       : ${compteurs.permissions}`);
    console.log(`   Rôles             : ${compteurs.roles}`);
    console.log(`   Liens rôle/perm.  : ${compteurs.liens}`);
    console.log(`   Utilisateurs      : ${compteurs.utilisateurs}`);
    console.log(`   Paramètres        : ${compteurs.parametres}`);

    if (simulation) {
      await client.query('ROLLBACK');
      console.log(
        '\n🔎 Simulation terminée : aucune donnée n’a été modifiée (ROLLBACK).\n'
      );
      return;
    }

    await client.query('COMMIT');
    console.log('\n✅ Réinitialisation socle terminée.');
    console.log('   Super administrateur : admin@agro-expertise.com / Admin@2026');
    console.log('   (changez ce mot de passe avant toute mise en production)\n');
  } catch (erreur) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Échec de la réinitialisation :', erreur.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

executer();
