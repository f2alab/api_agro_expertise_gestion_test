
// Thread de calcul du hachage bcrypt.
//
// bcryptjs est une implémentation JavaScript : une vérification de mot de passe
// au coût 10 consomme 80 à 200 ms de CPU. Exécutée sur le thread principal de
// Node, elle gèle TOUTES les autres requêtes (y compris les flux temps réel)
// pendant ce temps. Ce worker déporte donc le calcul hors du thread principal :
// les connexions simultanées du matin ne bloquent plus l'API.

import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort.on('message', async (message) => {
  const { id, operation, motDePasse, empreinte, cout } = message;

  try {
    const resultat =
      operation === 'hacher'
        ? await bcrypt.hash(motDePasse, cout)
        : await bcrypt.compare(motDePasse, empreinte);

    parentPort.postMessage({ id, resultat });
  } catch (erreur) {
    parentPort.postMessage({ id, erreur: erreur.message });
  }
});
