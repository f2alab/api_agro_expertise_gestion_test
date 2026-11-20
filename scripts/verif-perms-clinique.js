// Matrice des acces au module Clinique : quel role voit quelle entree.
// Usage : node scripts/verif-perms-clinique.js

import { fermerPool, query } from '../src/config/database.js';

/** Entrees du module et permission exigee (navigation.ts / App.tsx). */
const ENTREES = [
  ['Clinique', 'clinique.consultations.read'],
  ['Accueil', 'clinique.consultations.create'],
  ['Consult.', 'clinique.consultations.read'],
  ['Paraclin.', 'clinique.paracliniques.read'],
  ['Ordonn.', 'clinique.ordonnances.read'],
  ['Approb.', 'clinique.ordonnances.approve'],
  ['Factures', 'clinique.factures.read'],
  ['Dossiers', 'clinique.animaux.read'],
];

const { rows } = await query(`
  SELECT r.code AS role, p.code AS permission
  FROM roles r
  JOIN roles_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE p.module = 'clinique'
  ORDER BY r.code, p.code
`);

const parRole = new Map();
for (const ligne of rows) {
  const liste = parRole.get(ligne.role) ?? [];
  liste.push(ligne.permission);
  parRole.set(ligne.role, liste);
}

const entete = `${'ROLE'.padEnd(17)}${ENTREES.map(([nom]) => nom.padEnd(11)).join('')}NB`;
console.log(entete);
console.log('-'.repeat(entete.length));

for (const [role, permissions] of [...parRole.entries()].sort()) {
  const colonnes = ENTREES.map(([, permission]) =>
    (permissions.includes(permission) ? 'oui' : '-').padEnd(11)
  ).join('');
  const nb = role === 'SUPER_ADMIN' ? 'toutes' : String(permissions.length);
  console.log(`${role.padEnd(17)}${colonnes}${nb}`);
}

console.log('\nTotal permissions du module clinique :', rows.length ? new Set(rows.map((r) => r.permission)).size : 0);

/** Gestion du fichier : proprietaires et animaux (hors enregistrement au passage). */
const GESTION = [
  ['Propr.lire', 'clinique.proprietaires.read'],
  ['Propr.creer', 'clinique.proprietaires.create'],
  ['Propr.modif', 'clinique.proprietaires.update'],
  ['Anim.lire', 'clinique.animaux.read'],
  ['Anim.creer', 'clinique.animaux.create'],
  ['Anim.modif', 'clinique.animaux.update'],
  ['Anim.desac', 'clinique.animaux.delete'],
];

console.log(`\n${'ROLE'.padEnd(17)}${GESTION.map(([nom]) => nom.padEnd(12)).join('')}`);
console.log('-'.repeat(17 + GESTION.length * 12));

for (const [role, permissions] of [...parRole.entries()].sort()) {
  const colonnes = GESTION.map(([, permission]) =>
    (permissions.includes(permission) ? 'oui' : '-').padEnd(12)
  ).join('');
  console.log(`${role.padEnd(17)}${colonnes}`);
}

console.log(
  '\nRappel : POST /clinique/consultations/accueil cree le proprietaire et l\'animal',
  "\nau besoin avec la seule permission `clinique.consultations.create`."
);

await fermerPool();