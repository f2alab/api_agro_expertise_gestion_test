// Test de fumee du module Echeances et engagements financiers.
// Demarre l'API en memoire puis enchaine les appels cles :
//   - liste paginee, indicateurs consolides, rappels dus (cloche DG/DGA/Comptable) ;
//   - creation, rappel, historique, paiement et regles d'etat.
// Usage : node scripts/test-echeances.js

import { creerApplication } from '../src/app.js';
import { fermerPool } from '../src/config/database.js';

const application = creerApplication();
const serveur = application.listen(0);
await new Promise((resoudre) => serveur.once('listening', resoudre));
const base = `http://127.0.0.1:${serveur.address().port}/api`;

async function appel(chemin, { methode = 'GET', corps, jeton } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  const reponse = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const contenu = await reponse.json().catch(() => null);
  return { statut: reponse.status, contenu };
}

let reussis = 0;
function verifier(libelle, condition, details = '') {
  if (condition) {
    reussis += 1;
    console.log(`  OK    ${libelle}${details ? ` (${details})` : ''}`);
  } else {
    console.error(`  ECHEC ${libelle}${details ? ` (${details})` : ''}`);
  }
}

const admin = (
  await appel('/auth/connexion', {
    methode: 'POST',
    corps: { email: 'admin@agro-expertise.com', motDePasse: 'Admin@2026' },
  })
).contenu?.donnees;
const jeton = admin?.jetonAcces;
verifier('connexion administrateur', Boolean(jeton));

// 1) Liste paginee
const liste = await appel('/finances/echeances?limite=50', { jeton });
verifier(
  'liste paginee',
  liste.statut === 200 && Array.isArray(liste.contenu?.donnees?.donnees),
  `${liste.contenu?.donnees?.pagination?.total} echeance(s)`
);

// 2) Indicateurs consolides
const ind = await appel('/finances/echeances/indicateurs', { jeton });
verifier(
  'indicateurs',
  ind.statut === 200 && typeof ind.contenu?.donnees?.total === 'number',
  `a payer ${ind.contenu?.donnees?.aPayer} / retard ${ind.contenu?.donnees?.enRetard}`
);

// 3) Rappels dus (destines a la DG, la DGA et le Comptable)
const rappels = await appel('/finances/echeances/rappels', { jeton });
verifier(
  'rappels dus',
  rappels.statut === 200 && Array.isArray(rappels.contenu?.donnees),
  `${rappels.contenu?.donnees?.length} rappel(s)`
);

// 4) Creation d'une echeance
const creation = await appel('/finances/echeances', {
  methode: 'POST',
  jeton,
  corps: {
    nature: 'ENGAGEMENT',
    categorie: 'EMPRUNT',
    libelle: `Test echeance ${Date.now()}`,
    montant: 100000,
    dateEcheance: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    alerteJours: 7,
  },
});
verifier(
  'creation echeance',
  creation.statut === 201 && Boolean(creation.contenu?.donnees?.numero),
  creation.contenu?.donnees?.numero
);
const id = creation.contenu?.donnees?.id;

// 5) Rappel consigne
const rappel = await appel(`/finances/echeances/${id}/rappeler`, {
  methode: 'POST',
  jeton,
  corps: {},
});
verifier(
  'rappel consigne',
  rappel.statut === 201 && rappel.contenu?.donnees?.destinataires === 'DG,DGA,COMPTABLE',
  rappel.contenu?.donnees?.niveau
);

// 6) Historique des rappels
const hist = await appel(`/finances/echeances/${id}/rappels`, { jeton });
verifier('historique rappels', hist.statut === 200 && hist.contenu?.donnees?.length >= 1);

// 7) Paiement
const paiement = await appel(`/finances/echeances/${id}/payer`, {
  methode: 'POST',
  jeton,
  corps: { reference: 'TEST-REF' },
});
verifier(
  'marquer payee',
  paiement.statut === 200 && paiement.contenu?.donnees?.statut === 'PAYEE'
);

// 8) Une echeance reglee ne peut plus etre annulee
const annul = await appel(`/finances/echeances/${id}/annuler`, { methode: 'POST', jeton });
verifier('annulation echeance payee refusee (409)', annul.statut === 409, String(annul.statut));

// 9) Filtre par statut effectif (EN_RETARD)
const retard = await appel('/finances/echeances?statut=EN_RETARD', { jeton });
verifier(
  'filtre en retard',
  retard.statut === 200 && Array.isArray(retard.contenu?.donnees?.donnees),
  `${retard.contenu?.donnees?.pagination?.total} en retard`
);

console.log(`\n${reussis} verification(s) reussie(s).`);
serveur.close();
await fermerPool();