// Test de fumee du rapport « situation des ventes et de la caisse ».
//
// Verifie, sans passer par l'authentification HTTP (aucun mot de passe modifie) :
//   * les permissions `pharmacie.rapports.*` et leur attribution aux roles ;
//   * le cloisonnement : un compte rattache a une pharmacie (PPV, responsable)
//     ne genere la situation que pour SA pharmacie ; la direction (DG, DGA,
//     Directeur technique, Comptable, Tresorier, Auditeur) genere pour une
//     pharmacie precise ou pour tout le reseau ;
//   * la coherence des chiffres (solde de caisse = entrees - sorties) ;
//   * la structure du document (PV) : synthese, caisse, depenses, detail.
//
// Usage : node scripts/test-rapports.js

import { query, fermerPool } from '../src/config/database.js';
import { chargerProfil } from '../src/modules/auth/session.service.js';
import { perimetreUtilisateur, resoudrePointId } from '../src/utils/perimetre.js';
import { situation, ventesSituation } from '../src/modules/pharmacie/rapports/rapports.service.js';

let echecs = 0;
const verifier = (libelle, condition, detail = '') => {
  console.log(`${condition ? 'OK   ' : 'ECHEC'} ${libelle}${detail ? ` - ${detail}` : ''}`);
  if (!condition) echecs += 1;
};

// --- 1. Permissions du module ------------------------------------------------
const permissions = await query(
  `SELECT code FROM permissions WHERE code LIKE 'pharmacie.rapports.%' ORDER BY code`
);
verifier(
  'permissions pharmacie.rapports.read / export',
  permissions.rows.map((ligne) => ligne.code).join(',') ===
    'pharmacie.rapports.export,pharmacie.rapports.read',
  permissions.rows.map((ligne) => ligne.code).join(', ')
);

const ROLES_ATTENDUS = [
  'AUDITEUR',
  'COMPTABLE',
  'DG',
  'DGA',
  'DIR_TECHNIQUE',
  'PPV',
  'RESP_PHARMACIE',
  'SUPER_ADMIN',
  'TRESORIER',
];
const attributions = await query(
  `SELECT r.code AS role
   FROM roles_permissions rp
   JOIN roles r ON r.id = rp.role_id
   JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code LIKE 'pharmacie.rapports.%'
   GROUP BY r.code`
);
const rolesCouvert = new Set(attributions.rows.map((ligne) => ligne.role));
const manquants = ROLES_ATTENDUS.filter((role) => !rolesCouvert.has(role));
verifier('rapports attribues aux roles attendus', manquants.length === 0, manquants.join(', ') || 'tous');
// --- 2. Profils : portee globale ou comptes cloisonnes ----------------------
const utilisateurs = await query(
  `SELECT u.id, u.email, u.point_vente_id
   FROM utilisateurs u
   WHERE u.statut = 'ACTIF'
   ORDER BY u.email`
);

const profilsGlobaux = [];
const profilsCloisonnes = [];
for (const ligne of utilisateurs.rows) {
  const profil = await chargerProfil(ligne.id);
  if (!profil) continue;
  const perimetre = perimetreUtilisateur(profil);
  if (perimetre.global) profilsGlobaux.push(profil);
  else if (perimetre.pointId) profilsCloisonnes.push(profil);
}
verifier(
  'au moins un compte a portee globale',
  profilsGlobaux.length > 0,
  profilsGlobaux.map((profil) => profil.email).join(', ')
);
verifier(
  'au moins un compte cloisonne a une pharmacie',
  profilsCloisonnes.length > 0,
  profilsCloisonnes.map((profil) => `${profil.email}=${profil.pointVenteCode}`).join(', ')
);

const points = await query(`SELECT id, code, nom FROM pharmacie_points WHERE actif ORDER BY nom`);
verifier('reseau de pharmacies', points.rows.length >= 2, `${points.rows.length} pharmacie(s)`);

// --- 3. Perimetre : ce que chaque profil peut demander -----------------------
const autrePoint = (pointId) => points.rows.find((point) => point.id !== pointId);

for (const profil of profilsCloisonnes.slice(0, 3)) {
  const autre = autrePoint(profil.pointVenteId);
  // Un compte cloisonne est ramene a SA pharmacie, meme s'il demande une autre.
  const resolu = resoudrePointId(profil, autre?.id ?? null);
  verifier(
    `cloisonnement ${profil.email}`,
    resolu === profil.pointVenteId,
    `demande ${autre?.nom ?? '-'} -> ${profil.pointVenteNom}`
  );
}

for (const profil of profilsGlobaux.slice(0, 3)) {
  const cible = points.rows[0];
  verifier(
    `portee globale ${profil.email}`,
    resoudrePointId(profil, cible.id) === cible.id && resoudrePointId(profil, undefined) === null,
    'une pharmacie ou tout le reseau'
  );
}
// --- 4. Situation : tout le reseau ------------------------------------------
const acteur = profilsGlobaux[0];
const global = await situation({ du: '2024-01-01', au: '2026-12-31' }, acteur);
verifier(
  'situation globale : une ligne par pharmacie',
  global.parPoint.length === points.rows.length,
  `${global.parPoint.length} ligne(s)`
);
verifier('situation globale : portee annoncee', global.portee.globale === true);
verifier('document : synthese des ventes', typeof global.ventes.chiffreAffaires === 'number');
verifier(
  'document : caisse coherente (solde = entrees - sorties)',
  global.caisse.solde === Number((global.caisse.entrees.total - global.caisse.sorties.total).toFixed(2)),
  `${global.caisse.entrees.total} - ${global.caisse.sorties.total} = ${global.caisse.solde}`
);
verifier('document : detail des ventes pagine', Array.isArray((await ventesSituation({ du: '2024-01-01', au: '2026-12-31', limite: 5 })).donnees));
verifier(
  'document : pagination du detail exacte',
  (await ventesSituation({ du: '2024-01-01', au: '2026-12-31', limite: 1 })).pagination.total ===
    (await ventesSituation({ du: '2024-01-01', au: '2026-12-31', complet: true })).donnees.length,
  'total identique en page 1 et en mode complet'
);
verifier('document : auteur de l edition', typeof global.edite.parNom === 'string', global.edite.parNom ?? '-');
verifier('document : nombre de jours de la periode', global.periode.jours === 1096, `${global.periode.jours}`);
verifier('document : encaissements par mode', Array.isArray(global.encaissements.parMode));
verifier('document : depenses par categorie', Array.isArray(global.depenses.parCategorie));

// --- 5. Situation : une seule pharmacie -------------------------------------
const cible = points.rows[0];
const restreint = await situation({ du: '2024-01-01', au: '2026-12-31', pointId: cible.id }, acteur);
verifier(
  'situation par pharmacie : une seule ligne',
  restreint.parPoint.length === 1,
  restreint.portee.pointNom ?? '-'
);
verifier(
  'situation par pharmacie : perimetre annonce',
  restreint.portee.globale === false && restreint.portee.pointId === cible.id
);
verifier(
  "situation par pharmacie : aucune vente d'une autre pharmacie",
  (
    await ventesSituation({
      du: '2024-01-01',
      au: '2026-12-31',
      pointId: cible.id,
      complet: true,
    })
  ).donnees.every((vente) => vente.pointNom === cible.nom),
  cible.nom
);

// --- 6. Situation journaliere par defaut ------------------------------------
const journee = await situation({}, acteur);
verifier('situation journaliere par defaut', journee.periode.journaliere === true, journee.periode.du);

await fermerPool();
console.log(`\nTest termine : ${echecs === 0 ? 'succes' : `${echecs} echec(s)`}.`);
if (echecs > 0) process.exitCode = 1;