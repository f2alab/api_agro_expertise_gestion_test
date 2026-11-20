
// Initialisation de la base de données.
// Exécute dans l'ordre les scripts SQL du dossier backend/sql.
//
//   npm run db:setup          -> crée le schéma + les données de référence
//   npm run db:reset          -> DÉTRUIT tout puis recrée (développement)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/env.js';

const dossierCourant = path.dirname(fileURLToPath(import.meta.url));
const dossierSql = path.join(dossierCourant, '..', 'sql');

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

const avecReinitialisation = process.argv.includes('--reset');

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
  console.log(`\n📦 Base cible : ${config.baseDeDonnees.database}@${config.baseDeDonnees.host}:${config.baseDeDonnees.port}\n`);

  try {
    const liste = avecReinitialisation ? ['00_reset.sql', ...FICHIERS] : FICHIERS;

    for (const fichier of liste) {
      const chemin = path.join(dossierSql, fichier);
      const sql = await fs.readFile(chemin, 'utf8');
      process.stdout.write(`   → ${fichier} ... `);
      await client.query(sql);
      console.log('OK');
    }

    const { rows } = await client.query(`
      SELECT (SELECT count(*)::int FROM departements) AS departements,
             (SELECT count(*)::int FROM permissions)  AS permissions,
             (SELECT count(*)::int FROM roles)        AS roles,
             (SELECT count(*)::int FROM utilisateurs) AS utilisateurs
    `);
    const compteurs = rows[0];
    console.log('\n✅ Base initialisée.');
    console.log(`   Départements : ${compteurs.departements}`);
    console.log(`   Permissions  : ${compteurs.permissions}`);
    console.log(`   Rôles        : ${compteurs.roles}`);
    console.log(`   Utilisateurs : ${compteurs.utilisateurs}\n`);
  } catch (erreur) {
    console.error('\n❌ Échec de l’initialisation :', erreur.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

executer();