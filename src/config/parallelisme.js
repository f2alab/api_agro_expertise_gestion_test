
// Calcul du parallélisme : nombre de cœurs utilisables, processus de travail et
// threads de calcul.
//
// Principe « ça doit tenir sans réglage » :
//   * en production, on exploite tous les cœurs disponibles (borné à 8) ;
//   * en développement, un seul processus (compatible avec `node --watch`) ;
//   * les threads de hachage sont dimensionnés sur les cœurs, jamais moins de 2.
//
// Une valeur numérique explicite dans .env reste prioritaire (utile pour
// dimensionner finement un serveur ou désactiver le mécanisme avec 0).

import os from 'node:os';

/** Nombre de cœurs réellement exploitables. */
export const coeursDisponibles = Math.max(
  1,
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
);

/** Nombre maximal de processus (variable CLUSTER_WORKERS). */
export function resoudreWorkers(valeur, estProduction) {
  if (valeur === 'auto') {
    // En production : un processus par cœur (plafonné pour rester lisible),
    // en développement : un seul processus.
    return estProduction ? Math.min(coeursDisponibles, 8) : 1;
  }
  return valeur;
}

/** Nombre de threads dédiés au hachage (variable HACHAGE_WORKERS). */
export function resoudreThreadsHachage(valeur, estProduction) {
  if (valeur === 'auto') {
    const maximum = estProduction ? 8 : 4;
    return Math.max(2, Math.min(coeursDisponibles, maximum));
  }
  return valeur;
}
