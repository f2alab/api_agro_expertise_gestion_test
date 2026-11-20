
// Test de fumée de l'API IAM (aucune dépendance externe, Node >= 18).
// Prérequis : serveur démarré (npm run dev) sur http://localhost:3000
//
//   node scripts/test-api.js
//
// Le script parcourt le cycle complet : authentification, RBAC, CRUD
// utilisateurs / rôles / départements, audit et rotation des jetons.

import assert from 'node:assert/strict';

const BASE = process.env.API_URL ?? 'http://localhost:3000/api';
const suffixe = Date.now().toString().slice(-6);
let reussis = 0;

/** Appel HTTP générique ; renvoie { statut, corps }. */
async function appel(methode, chemin, { corps, jeton } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;

  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });

  let corpsReponse = null;
  try {
    corpsReponse = await reponse.json();
  } catch {
    corpsReponse = null;
  }
  return { statut: reponse.status, corps: corpsReponse };
}

/** Vérifie un cas de test et affiche le résultat. */
function verifier(libelle, condition, details = '') {
  if (condition) {
    reussis += 1;
    console.log(`  ✅ ${libelle}`);
  } else {
    console.error(`  ❌ ${libelle} ${details}`);
    assert.fail(`Test échoué : ${libelle}`);
  }
}

async function executer() {
  console.log(`\n🧪 Test de fumée API IAM - ${BASE}\n`);

  // 1. Santé ---------------------------------------------------------------
  const sante = await appel('GET', '/sante');
  verifier('API joignable', sante.statut === 200 && sante.corps.donnees.statut === 'OK');

  // 2. Connexion administrateur -------------------------------------------
  const connexion = await appel('POST', '/auth/connexion', {
    corps: { email: 'admin@agro-expertise.com', motDePasse: 'Admin@2026' },
  });
  verifier(
    'Connexion super administrateur',
    connexion.statut === 200 && Boolean(connexion.corps.donnees.jetonAcces)
  );

  const jetonAdmin = connexion.corps.donnees.jetonAcces;
  const jetonRafraichissement = connexion.corps.donnees.jetonRafraichissement;

  // Le catalogue de permissions évolue avec les modules : on compare le super
  // administrateur au nombre réel en base (jamais de valeur figée dans le test).
  const cataloguePermissions = await appel('GET', '/permissions', { jeton: jetonAdmin });
  const totalPermissions = cataloguePermissions.corps?.donnees?.total ?? 0;
  verifier(
    'Super administrateur = toutes les permissions',
    totalPermissions > 0 && connexion.corps.donnees.utilisateur.permissions.length === totalPermissions
  );

  // 3. Profil courant ------------------------------------------------------
  const moi = await appel('GET', '/auth/moi', { jeton: jetonAdmin });
  verifier(
    'GET /auth/moi',
    moi.statut === 200 && moi.corps.donnees.email === 'admin@agro-expertise.com'
  );

  // 4. Lectures de référence ----------------------------------------------
  const departements = await appel('GET', '/departements', { jeton: jetonAdmin });
  verifier('Organigramme chargé (28 départements)', departements.corps.donnees.total === 28);

  const roles = await appel('GET', '/roles', { jeton: jetonAdmin });
  verifier('Catalogue des rôles (au moins 18)', (roles.corps?.donnees?.length ?? 0) >= 18);

  // Même réponse que ci-dessus : on évite un second appel réseau
  const permissions = cataloguePermissions;
  verifier('Catalogue des permissions (au moins 50)', totalPermissions >= 50);

  // 5. Création d'un utilisateur de test ----------------------------------
  const emailTest = `test.${suffixe}@agro-expertise.com`;
  const roleTechnicien = roles.corps.donnees.find((role) => role.code === 'TECHNICIEN');
  const departementClinique = departements.corps.donnees.liste.find((d) => d.code === 'CLIN_TECH');

  const creation = await appel('POST', '/utilisateurs', {
    jeton: jetonAdmin,
    corps: {
      nom: 'TEST',
      prenom: 'Agent',
      email: emailTest,
      fonction: 'Technicien de test',
      departementId: departementClinique.id,
      roleIds: [roleTechnicien.id],
    },
  });
  verifier('Création utilisateur (201)', creation.statut === 201);
  const utilisateurCree = creation.corps.donnees.utilisateur;
  const motDePasseProvisoire = creation.corps.donnees.motDePasseProvisoire;
  verifier(
    'Mot de passe provisoire généré',
    typeof motDePasseProvisoire === 'string' && motDePasseProvisoire.length >= 12
  );
  verifier('Rôle attribué', utilisateurCree.roles.some((r) => r.code === 'TECHNICIEN'));

  // 6. Connexion de l'utilisateur de test (RBAC restreint) ----------------
  const connexionTest = await appel('POST', '/auth/connexion', {
    corps: { email: emailTest, motDePasse: motDePasseProvisoire },
  });
  verifier('Connexion utilisateur de test', connexionTest.statut === 200);
  const jetonTest = connexionTest.corps.donnees.jetonAcces;
  verifier(
    'Permissions limitées pour le technicien',
    connexionTest.corps.donnees.utilisateur.permissions.length < totalPermissions
  );

  const interdit = await appel('GET', '/utilisateurs', { jeton: jetonTest });
  verifier(
    'Accès refusé sans permission (403)',
    interdit.statut === 403 && interdit.corps.erreur.code === 'PERMISSION_REFUSEE'
  );

  // 7. Modification de l'utilisateur --------------------------------------
  const modification = await appel('PATCH', `/utilisateurs/${utilisateurCree.id}`, {
    jeton: jetonAdmin,
    corps: { fonction: 'Technicien confirmé' },
  });
  verifier(
    'Modification utilisateur',
    modification.statut === 200 && modification.corps.donnees.fonction === 'Technicien confirmé'
  );

  // 8. Désactivation / réactivation ---------------------------------------
  const desactivation = await appel('PATCH', `/utilisateurs/${utilisateurCree.id}`, {
    jeton: jetonAdmin,
    corps: { statut: 'INACTIF' },
  });
  verifier('Désactivation du compte', desactivation.corps.donnees.statut === 'INACTIF');

  const connexionRefusee = await appel('POST', '/auth/connexion', {
    corps: { email: emailTest, motDePasse: motDePasseProvisoire },
  });
  verifier(
    'Connexion refusée compte inactif (403)',
    connexionRefusee.statut === 403 && connexionRefusee.corps.erreur.code === 'COMPTE_INACTIF'
  );

  // 9. Cycle de vie d'un rôle --------------------------------------------
  const creationRole = await appel('POST', '/roles', {
    jeton: jetonAdmin,
    corps: {
      code: `TEST_ROLE_${suffixe}`,
      nom: 'Rôle de test',
      description: 'Créé par le test automatisé',
      niveau: 70,
    },
  });
  verifier('Création rôle', creationRole.statut === 201);
  const roleCree = creationRole.corps.donnees;

  const permissionLecture = permissions.corps.donnees.permissions.find(
    (p) => p.code === 'pharmacie.stocks.read'
  );
  const affectation = await appel('PUT', `/roles/${roleCree.id}/permissions`, {
    jeton: jetonAdmin,
    corps: { permissionIds: [permissionLecture.id] },
  });
  verifier(
    'Affectation de permissions au rôle',
    affectation.statut === 200 && affectation.corps.donnees.nbPermissions === 1
  );

  const suppressionRole = await appel('DELETE', `/roles/${roleCree.id}`, { jeton: jetonAdmin });
  verifier('Suppression rôle', suppressionRole.statut === 200);

  // 10. Cycle de vie d'un département ------------------------------------
  const parentPharmacie = departements.corps.donnees.liste.find((d) => d.code === 'PHARMA_SUCC');
  const creationDepartement = await appel('POST', '/departements', {
    jeton: jetonAdmin,
    corps: {
      code: `SUCC_${suffixe}`,
      nom: 'Succursale de test',
      parentId: parentPharmacie.id,
      typeUnite: 'SUCCURSALE',
      ville: 'Kara',
    },
  });
  verifier('Création département', creationDepartement.statut === 201);
  verifier(
    'Chemin hiérarchique recalculé',
    creationDepartement.corps.donnees.chemin.endsWith(`/SUCC_${suffixe}`)
  );

  const suppressionDepartement = await appel(
    'DELETE',
    `/departements/${creationDepartement.corps.donnees.id}`,
    { jeton: jetonAdmin }
  );
  verifier('Suppression département', suppressionDepartement.statut === 200);

  // 11. Rotation des jetons ----------------------------------------------
  const rafraichissement = await appel('POST', '/auth/rafraichir', {
    corps: { jetonRafraichissement },
  });
  verifier('Rotation du jeton de rafraîchissement', rafraichissement.statut === 200);

  const reutilisation = await appel('POST', '/auth/rafraichir', {
    corps: { jetonRafraichissement },
  });
  verifier(
    'Réutilisation d’un jeton révoqué détectée (401)',
    reutilisation.statut === 401 && reutilisation.corps.erreur.code === 'SESSION_REUTILISEE'
  );

  // 12. Journal d'audit ---------------------------------------------------
  const audit = await appel('GET', '/journal-audit?limite=50', { jeton: jetonAdmin });
  verifier(
    'Journal d’audit alimenté',
    audit.statut === 200 &&
      audit.corps.donnees.donnees.some((evenement) => evenement.action === 'CREATION_UTILISATEUR')
  );

  // 13. Tableau de bord ---------------------------------------------------
  const tableauDeBord = await appel('GET', '/tableau-de-bord', { jeton: jetonAdmin });
  verifier(
    'Tableau de bord disponible',
    tableauDeBord.statut === 200 && tableauDeBord.corps.donnees.compteurs.utilisateurs_total >= 3
  );

  // 14. Nettoyage ---------------------------------------------------------
  const archivage = await appel('DELETE', `/utilisateurs/${utilisateurCree.id}`, {
    jeton: jetonAdmin,
  });
  verifier('Archivage du compte de test', archivage.statut === 200);

  console.log(`\n🎉 ${reussis} vérifications réussies.\n`);
}

executer().catch((erreur) => {
  console.error('\n💥', erreur.message, '\n');
  process.exitCode = 1;
});