
// Hachage bcrypt déporté dans un pool de threads de calcul.
//
// Pourquoi : bcryptjs bloque le thread principal de Node pendant 80 à 200 ms
// par vérification. À 500–1000 utilisateurs qui se connectent le matin, cela
// gèle l'API entière (et les flux temps réel). Ici, le calcul est exécuté dans
// des workers : l'API reste réactive et les hachages se parallélisent sur
// plusieurs cœurs.
//
// Robustesse :
//   * les threads sont créés à la demande (aucun coût au démarrage) ;
//   * répartition sur le thread le moins chargé ;
//   * si un thread meurt, les calculs en cours sont repris localement :
//     une connexion ne peut pas échouer à cause de ce mécanisme ;
//   * HACHAGE_WORKERS=0 désactive le mécanisme (repli sur le thread principal).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const CHEMIN_WORKER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'workers',
  'hachage.worker.js'
);

let slots = [];
let initialise = false;
let prochainIdentifiant = 1;

/** Exécution de secours sur le thread principal. */
async function executerLocalement(operation, donnees) {
  if (operation === 'hacher') return bcrypt.hash(donnees.motDePasse, donnees.cout);
  return bcrypt.compare(donnees.motDePasse, donnees.empreinte);
}

/**
 * Reprend en local les calculs d'un thread devenu indisponible.
 * Une panne technique ne doit jamais empêcher une connexion.
 */
function replierEnLocal(slot, motif) {
  const attentes = [...slot.enAttente.values()];
  slot.enAttente.clear();
  slot.charge = 0;
  slot.indisponible = true;

  if (attentes.length > 0) {
    logger.warn(`Hachage : ${attentes.length} calcul(s) repris sur le thread principal (${motif}).`);
  }

  for (const attente of attentes) {
    executerLocalement(attente.operation, attente.donnees).then(attente.resoudre, attente.rejeter);
  }
}

function creerSlot() {
  const worker = new Worker(CHEMIN_WORKER);
  const slot = { worker, enAttente: new Map(), charge: 0, indisponible: false };

  worker.on('message', (message) => {
    const attente = slot.enAttente.get(message.id);
    if (!attente) return;

    slot.enAttente.delete(message.id);
    slot.charge = Math.max(0, slot.charge - 1);

    if (message.erreur) attente.rejeter(new Error(message.erreur));
    else attente.resoudre(message.resultat);
  });

  worker.on('error', (erreur) => replierEnLocal(slot, `erreur de thread : ${erreur.message}`));
  worker.on('exit', (code) => {
    if (!slot.indisponible && !slot.arretDemande) replierEnLocal(slot, `thread terminé (code ${code})`);
  });

  worker.unref?.();
  return slot;
}

function initialiser() {
  if (initialise) return;
  initialise = true;

  const nombre = config.securite.hachageWorkers;
  if (nombre <= 0) {
    logger.info('Hachage : exécution sur le thread principal (HACHAGE_WORKERS=0).');
    return;
  }

  try {
    slots = Array.from({ length: nombre }, () => creerSlot());
    logger.info(`Hachage : ${nombre} thread(s) de calcul dédié(s) activé(s).`);
  } catch (erreur) {
    slots = [];
    logger.warn(
      `Hachage : création des threads impossible (${erreur.message}), repli sur le thread principal.`
    );
  }
}

/** Thread disponible le moins chargé. */
function choisirSlot() {
  let meilleur = null;
  for (const slot of slots) {
    if (slot.indisponible) continue;
    if (!meilleur || slot.charge < meilleur.charge) meilleur = slot;
  }
  return meilleur;
}

async function executer(operation, donnees) {
  initialiser();

  const slot = choisirSlot();
  if (!slot) return executerLocalement(operation, donnees);

  const identifiant = prochainIdentifiant++;

  return new Promise((resoudre, rejeter) => {
    slot.charge += 1;
    slot.enAttente.set(identifiant, { resoudre, rejeter, operation, donnees });

    try {
      slot.worker.postMessage({ id: identifiant, operation, ...donnees });
    } catch (erreur) {
      slot.enAttente.delete(identifiant);
      slot.charge = Math.max(0, slot.charge - 1);
      executerLocalement(operation, donnees).then(resoudre, rejeter);
    }
  });
}

/** Hache un mot de passe en clair (coût configurable). */
export const hacherMotDePasse = (motDePasse) =>
  executer('hacher', { motDePasse, cout: config.securite.coutBcrypt });

/** Compare un mot de passe en clair avec son empreinte bcrypt. */
export const verifierMotDePasse = (motDePasse, empreinte) =>
  executer('comparer', { motDePasse, empreinte });

/** Arrête les threads de calcul (arrêt du serveur). */
export async function arreterHachage() {
  const aFermer = slots;
  slots = [];
  initialise = false;

  await Promise.all(
    aFermer.map(async (slot) => {
      slot.arretDemande = true;
      replierEnLocal(slot, 'arrêt du serveur');
      try {
        await slot.worker.terminate();
      } catch {
        // Thread déjà terminé
      }
    })
  );
}

/** État du pool (supervision). */
export const statistiquesHachage = () => ({
  threads: slots.filter((slot) => !slot.indisponible).length,
  configuration: config.securite.hachageWorkers,
  calculsEnCours: slots.reduce((total, slot) => total + slot.charge, 0),
});
