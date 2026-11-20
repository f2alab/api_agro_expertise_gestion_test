
// Test de fumée du temps réel (flux SSE + LISTEN/NOTIFY PostgreSQL).
// Démarre l'API en mémoire, ouvre un flux avec le compte super administrateur,
// déclenche une modification métier et vérifie que l'événement arrive.
// Usage : node scripts/test-temps-reel.js

import { creerApplication } from '../src/app.js';
import { fermerPool } from '../src/config/database.js';
import { arreterBus, demarrerBus } from '../src/realtime/bus.js';
import { fermerTousLesFlux } from '../src/realtime/sse.js';

const application = creerApplication();
const serveur = application.listen(0);
await new Promise((resoudre) => serveur.once('listening', resoudre));
const base = `http://127.0.0.1:${serveur.address().port}/api`;

const resultats = [];
const verifier = (libelle, condition, detail = '') => {
  resultats.push({ libelle, ok: Boolean(condition) });
  console.log(`${condition ? 'OK  ' : 'ECHEC'} ${libelle}${detail ? ` - ${detail}` : ''}`);
};

async function appel(chemin, options = {}) {
  const reponse = await fetch(`${base}${chemin}`, options);
  const contenu = await reponse.json().catch(() => null);
  return { statut: reponse.status, contenu };
}

const attendre = async (predicat, delaiMs = 10_000) => {
  const limite = Date.now() + delaiMs;
  for (;;) {
    if (predicat()) return true;
    if (Date.now() > limite) return false;
    await new Promise((resoudre) => setTimeout(resoudre, 150));
  }
};

// 1) Écoute du canal PostgreSQL (hors index.js, non démarré dans ce test)
const ecouteActive = await demarrerBus();
verifier('écoute du canal PostgreSQL', ecouteActive === true);

// 2) Connexion du super administrateur
const connexion = await appel('/auth/connexion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@agro-expertise.com', motDePasse: 'Admin@2026' }),
});
verifier('connexion', connexion.statut === 200, String(connexion.statut));

const jeton = connexion.contenu?.donnees?.jetonAcces;
const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };

// 3) Le flux exige un jeton valide
const sansJeton = await appel('/temps-reel/flux');
verifier('flux refusé sans jeton', sansJeton.statut === 401, String(sansJeton.statut));

// 4) État et catalogue des types
const etat = await appel('/temps-reel/etat', { headers: entetes });
verifier('état du temps réel', etat.statut === 200 && etat.contenu?.donnees?.bus, String(etat.statut));

const types = await appel('/temps-reel/types', { headers: entetes });
const nombreTypes = Object.keys(types.contenu?.donnees ?? {}).length;
verifier('catalogue des types', nombreTypes >= 10, `${nombreTypes} types`);

// 5) Ouverture du flux SSE
const controleur = new AbortController();
const reponseFlux = await fetch(`${base}/temps-reel/flux`, {
  headers: { Authorization: `Bearer ${jeton}`, Accept: 'text/event-stream' },
  signal: controleur.signal,
});
verifier(
  'ouverture du flux SSE',
  reponseFlux.status === 200 &&
    (reponseFlux.headers.get('content-type') ?? '').includes('text/event-stream'),
  `${reponseFlux.status} ${reponseFlux.headers.get('content-type') ?? ''}`
);

const evenements = [];
let pret = false;

const traiter = (bloc) => {
  let nom = 'message';
  let donnees = '';
  for (const ligne of bloc.split('\n')) {
    if (!ligne || ligne.startsWith(':')) continue;
    const separateur = ligne.indexOf(':');
    const champ = separateur === -1 ? ligne : ligne.slice(0, separateur);
    const valeur = separateur === -1 ? '' : ligne.slice(separateur + 1).replace(/^ /, '');
    if (champ === 'event') nom = valeur;
    else if (champ === 'data') donnees += valeur;
  }
  if (nom === 'pret') pret = true;
  if (nom === 'evenement') {
    try {
      evenements.push(JSON.parse(donnees));
    } catch {
      // Trame illisible : ignorée
    }
  }
};

const lireFlux = async () => {
  const lecteur = reponseFlux.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '';
  try {
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += decodeur.decode(value, { stream: true });
      let separateur = tampon.indexOf('\n\n');
      while (separateur !== -1) {
        traiter(tampon.slice(0, separateur));
        tampon = tampon.slice(separateur + 2);
        separateur = tampon.indexOf('\n\n');
      }
    }
  } catch {
    // Flux fermé en fin de test
  }
};
void lireFlux();

verifier('handshake « pret » reçu', await attendre(() => pret), JSON.stringify(evenements.length));

// 6) Modification métier -> un événement doit être diffusé
const creation = await appel('/pharmacie/clients', {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({ nom: `Client temps réel ${Date.now()}` }),
});
verifier('création client', creation.statut === 201, String(creation.statut));

const evenementRecu = await attendre(() => evenements.some((e) => e.type === 'pharmacie.clients'));
verifier(
  'événement « pharmacie.clients » reçu',
  evenementRecu,
  evenements.map((e) => `${e.type}/${e.operation}`).join(', ') || 'aucun événement'
);

// 7) Nettoyage
const clientCree = creation.contenu?.donnees?.id;
if (clientCree) await appel(`/pharmacie/clients/${clientCree}`, { method: 'DELETE', headers: entetes });

controleur.abort();
fermerTousLesFlux('fin de test');
await arreterBus();
await fermerPool();
await new Promise((resoudre) => serveur.close(resoudre));

const echecs = resultats.filter((resultat) => !resultat.ok).length;
console.log(`\n${echecs === 0 ? '✅' : '❌'} ${resultats.length - echecs}/${resultats.length} vérifications réussies.\n`);
process.exit(echecs === 0 ? 0 : 1);
