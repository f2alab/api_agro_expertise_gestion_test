
// Test de charge de l'API temps réel.
//
// Mesure ce qui compte pour la tenue en charge :
//   * nombre de flux SSE réellement ouverts (et refusés) ;
//   * événements temps réel reçus par les flux ;
//   * latence des requêtes API (p50 / p95 / p99) et débit ;
//   * codes d'erreur rencontrés (429, 500, 503...).
//
// Usage (serveur lancé à part ou non) :
//   node scripts/test-charge.js --flux=200 --requetes=50 --duree=20 --ventes=2
//   node scripts/test-charge.js --url=http://localhost:3000/api --flux=500
//
// Important : le nombre de flux par utilisateur est limité
// (TEMPS_REEL_FLUX_MAX_PAR_UTILISATEUR). Pour simuler 200 flux avec un seul
// compte, lancez le serveur avec une valeur au moins égale.

import { creerApplication } from '../src/app.js';
import { config } from '../src/config/env.js';
import { fermerPool } from '../src/config/database.js';
import { arreterBus, demarrerBus } from '../src/realtime/bus.js';
import { arreterHachage } from '../src/utils/hachage.js';

// Ce script n'est pas un test unitaire : il ne doit pas être exécuté
// automatiquement par `npm test` (banc de charge volontairement long).
if (process.env.NODE_TEST_CONTEXT) {
  console.log('Banc de charge ignoré (exécution manuelle : node scripts/test-charge.js)');
  process.exit(0);
}

// --- Options -----------------------------------------------------------------
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [cle, valeur] = argument.replace(/^--/, '').split('=');
    return [cle, valeur ?? 'true'];
  })
);

const encoder = (valeur, defaut) => {
  const nombre = Number(valeur);
  return Number.isFinite(nombre) && nombre > 0 ? nombre : defaut;
};

const nombreFlux = encoder(options.flux, 100);
const requetesParSeconde = encoder(options.requetes, 30);
const dureeSecondes = encoder(options.duree, 15);
const ventesParSeconde = encoder(options.ventes, 1);
const email = options.email ?? 'admin@agro-expertise.com';
const motDePasse = options.motDePasse ?? 'Admin@2026';

// --- Serveur (interne si aucune URL fournie) ---------------------------------
let serveur = null;
let base = options.url ?? null;

if (!base) {
  const application = creerApplication();
  serveur = application.listen(0);
  await new Promise((resoudre) => serveur.once('listening', resoudre));
  base = `http://127.0.0.1:${serveur.address().port}/api`;
  await demarrerBus();
}

console.log(`\n🔥 Test de charge sur ${base}`);
console.log(
  `   ${nombreFlux} flux SSE · ${requetesParSeconde} req/s · ${ventesParSeconde} écriture(s)/s · ${dureeSecondes} s`
);
console.log(
  `   (quota de flux par utilisateur : ${config.tempsReel.fluxMaxParUtilisateur} - ajustez TEMPS_REEL_FLUX_MAX_PAR_UTILISATEUR pour simuler davantage)\n`
);

// --- Connexion ---------------------------------------------------------------
const reponseConnexion = await fetch(`${base}/auth/connexion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, motDePasse }),
});
const contenuConnexion = await reponseConnexion.json();

if (!reponseConnexion.ok) {
  console.error('❌ Connexion impossible :', contenuConnexion?.erreur?.message ?? reponseConnexion.status);
  process.exit(1);
}

const jeton = contenuConnexion.donnees.jetonAcces;
const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };

// --- Ouverture des flux SSE --------------------------------------------------
const flux = [];
let fluxOuverts = 0;
let fluxRefuses = 0;
let evenementsRecus = 0;

const ouvrirFlux = async () => {
  const controleur = new AbortController();
  let reponse;

  try {
    reponse = await fetch(`${base}/temps-reel/flux`, {
      headers: { Authorization: `Bearer ${jeton}`, Accept: 'text/event-stream' },
      signal: controleur.signal,
    });
  } catch {
    fluxRefuses += 1;
    return;
  }

  if (!reponse.ok || !reponse.body) {
    fluxRefuses += 1;
    return;
  }

  fluxOuverts += 1;
  const entree = { controleur, evenements: 0 };
  flux.push(entree);

  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '';

  // Lecture en tâche de fond : compte les événements reçus
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, { stream: true });
        let separateur = tampon.indexOf('\n\n');
        while (separateur !== -1) {
          const bloc = tampon.slice(0, separateur);
          tampon = tampon.slice(separateur + 2);
          if (bloc.includes('event: evenement')) {
            entree.evenements += 1;
            evenementsRecus += 1;
          }
          separateur = tampon.indexOf('\n\n');
        }
      }
    } catch {
      // Flux fermé en fin de test
    }
  })();
};

const debutOuverture = Date.now();

// Ouverture par vagues : dans la réalité, les utilisateurs se connectent
// progressivement. Ouvrir des centaines de connexions TCP strictement en même
// temps sature la file d'attente du système (backlog) et fausse la mesure.
const tailleVague = encoder(options.parVague, 25);

for (let index = 0; index < nombreFlux; index += tailleVague) {
  const vague = Array.from(
    { length: Math.min(tailleVague, nombreFlux - index) },
    () => ouvrirFlux()
  );
  await Promise.all(vague);
  await new Promise((resoudre) => setTimeout(resoudre, 60));
}

console.log(`🔌 Flux SSE : ${fluxOuverts} ouvert(s), ${fluxRefuses} refusé(s) en ${Date.now() - debutOuverture} ms`);

// --- Latences des requêtes API ----------------------------------------------
const chemins = [
  '/pharmacie/ventes?limite=20',
  '/pharmacie/stocks/valorisation',
  '/pharmacie/stocks/alertes',
  '/pharmacie/tableau-de-bord',
  '/pharmacie/points',
];
const latences = [];
const latencesRefusees = [];
const erreurs = new Map();
let requetesEnvoyees = 0;
let requetesReussies = 0;
let arretDemande = false;

const travailleur = async () => {
  while (!arretDemande) {
    const chemin = chemins[Math.floor(Math.random() * chemins.length)];
    const debut = process.hrtime.bigint();

    try {
      const reponse = await fetch(`${base}${chemin}`, { headers: entetes });
      const duree = Number(process.hrtime.bigint() - debut) / 1_000_000;
      requetesEnvoyees += 1;

      if (reponse.ok) {
        requetesReussies += 1;
        latences.push(duree);
      } else {
        latencesRefusees.push(duree);
        const cle = `${reponse.status} ${chemin.split('?')[0]}`;
        erreurs.set(cle, (erreurs.get(cle) ?? 0) + 1);
      }
      await reponse.arrayBuffer();
    } catch {
      const cle = `réseau ${chemin.split('?')[0]}`;
      erreurs.set(cle, (erreurs.get(cle) ?? 0) + 1);
    }
  }
};

const nombreTravailleurs = Math.max(1, Math.ceil(requetesParSeconde / 5));
const debutMesure = Date.now();
const travailleurs = Array.from({ length: nombreTravailleurs }, () => travailleur());

// --- Générateur d'écritures (déclenche le temps réel) ------------------------
const reponseClients = await fetch(`${base}/pharmacie/clients`, { headers: entetes });
const clients = await reponseClients.json();
const premierClient = clients?.donnees?.[0] ?? null;
const nomOrigine = premierClient?.nom ?? null;
let ecritures = 0;

// Mise à jour du même client : produit de vrais événements de changement sans
// créer de données de test (le nom d'origine est restauré à la fin).
const generer = async () => {
  if (!premierClient) return;
  try {
    const reponse = await fetch(`${base}/pharmacie/clients/${premierClient.id}`, {
      method: 'PATCH',
      headers: entetes,
      body: JSON.stringify({ nom: `${nomOrigine} · ${Date.now() % 1000}` }),
    });
    if (reponse.ok) ecritures += 1;
  } catch {
    // Ignoré : le test porte sur la lecture
  }
};

const minuterieEcriture = setInterval(() => void generer(), Math.round(1000 / ventesParSeconde));

// --- Attente -----------------------------------------------------------------
await new Promise((resoudre) => setTimeout(resoudre, dureeSecondes * 1000));
arretDemande = true;
clearInterval(minuterieEcriture);
await Promise.all(travailleurs);

// --- Restauration ------------------------------------------------------------
if (premierClient && nomOrigine) {
  await fetch(`${base}/pharmacie/clients/${premierClient.id}`, {
    method: 'PATCH',
    headers: entetes,
    body: JSON.stringify({ nom: nomOrigine }),
  }).catch(() => undefined);
}

for (const entree of flux) entree.controleur.abort();

// --- Rapport -----------------------------------------------------------------
const percentile = (liste, pourcentage) => {
  if (liste.length === 0) return 0;
  const triees = [...liste].sort((a, b) => a - b);
  return triees[Math.min(triees.length - 1, Math.floor((pourcentage / 100) * triees.length))];
};

const dureeReelle = (Date.now() - debutMesure) / 1000;

console.log('\n📊 Résultats');
console.log(
  `   Requêtes API      : ${requetesEnvoyees} envoyées, ${requetesReussies} réussies en ${dureeReelle.toFixed(1)} s (${(requetesReussies / dureeReelle).toFixed(0)} req/s utiles)`
);
console.log(
  `   Latence (200 OK)  : p50 ${percentile(latences, 50).toFixed(0)} ms · p95 ${percentile(latences, 95).toFixed(0)} ms · p99 ${percentile(latences, 99).toFixed(0)} ms · max ${Math.max(0, ...latences).toFixed(0)} ms`
);
if (latencesRefusees.length > 0) {
  console.log(
    `   Latence (refus)   : p50 ${percentile(latencesRefusees, 50).toFixed(0)} ms · p95 ${percentile(latencesRefusees, 95).toFixed(0)} ms`
  );
}
console.log(`   Flux SSE ouverts  : ${fluxOuverts} / ${nombreFlux}`);
console.log(`   Écritures         : ${ecritures}`);
console.log(
  `   Événements reçus  : ${evenementsRecus}${fluxOuverts > 0 ? ` (${(evenementsRecus / fluxOuverts).toFixed(1)} par flux)` : ''}`
);
console.log(
  `   Erreurs           : ${erreurs.size === 0 ? 'aucune' : [...erreurs.entries()].map(([cle, total]) => `${cle} ×${total}`).join(', ')}`
);
if (erreurs.size > 0) {
  console.log(
    '   Note              : les 429 viennent de la limitation par utilisateur (un seul compte utilisé ici).\n' +
      '                        Relancez avec RATE_LIMIT_MAX élevé (ex. 50000) pour mesurer la latence réelle.'
  );
}
console.log(`   Mémoire du process: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} Mo\n`);

// --- Arrêt -------------------------------------------------------------------
if (serveur) {
  await arreterBus();
  await arreterHachage();
  await fermerPool();
  await new Promise((resoudre) => serveur.close(resoudre));
}
process.exit(0);
