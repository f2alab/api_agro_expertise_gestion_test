
// Cache mémoire des réponses JSON des endpoints agrégés.
//
// Les tableaux de bord, valorisations et indicateurs financiers produisent la
// même réponse pour tous les utilisateurs autorisés : sans cache, 200 à 1000
// utilisateurs déclenchaient autant d'exécutions des mêmes agrégations SQL.
// Avec ce cache, une seule exécution sert tout le monde.
//
// Sûreté :
//   * le contrôle de permission (`autoriser`) s'exécute TOUJOURS avant le cache,
//     donc personne ne peut lire une réponse qu'il n'a pas le droit de voir ;
//   * la clé est l'URL complète (filtres inclus), jamais l'utilisateur ;
//   * ce cache ne doit être appliqué qu'aux endpoints dont la réponse ne dépend
//     pas de `req.utilisateur` (vérifié : aucun des écrans concernés) ;
//   * invalidation immédiate sur les événements temps réel du module concerné,
//     avec un TTL court (CACHE_REPONSE_SECONDES, 20 s) en filet de sécurité.

import { config } from '../config/env.js';
import { abonner } from '../realtime/bus.js';
import { creerCache } from '../utils/cache.js';

const cache = creerCache({
  nom: 'reponses-agregees',
  ttlSecondes: config.securite.cacheReponseSecondes,
  maximum: 5_000,
});

/** Préfixes d'URL à purger selon l'origine du changement. */
const REGLES_INVALIDATION = [
  {
    concerne: (type) => type.startsWith('pharmacie.'),
    prefixes: ['/api/pharmacie', '/api/tableau-de-bord', '/api/direction'],
  },
  {
    concerne: (type) => type.startsWith('finance.'),
    prefixes: ['/api/finances', '/api/direction'],
  },
  {
    concerne: (type) => type.startsWith('iam.'),
    prefixes: [
      '/api/tableau-de-bord',
      '/api/direction',
      '/api/utilisateurs',
      '/api/roles',
      '/api/departements',
      '/api/journal-audit',
    ],
  },
];

abonner((evenement) => {
  for (const regle of REGLES_INVALIDATION) {
    if (!regle.concerne(evenement.type)) continue;
    for (const prefixe of regle.prefixes) cache.invaliderParPrefixe(prefixe);
  }
});

/**
 * Middleware de mise en cache des réponses GET (à placer après `autoriser`).
 *
 * @param {object} [options]
 * @param {boolean} [options.parUtilisateur] Inclut le périmètre de l'utilisateur
 *   dans la clé. Obligatoire pour les réponses dont le contenu dépend du profil
 *   (tableaux de bord et finances cloisonnés par pharmacie).
 */
export function cacheReponse(options = {}) {
  const { parUtilisateur = false } = options;
  return (req, res, next) => {
    if (config.securite.cacheReponseSecondes <= 0 || req.method !== 'GET') return next();

    // Clé = URL + périmètre (jamais le contenu métier) pour éviter qu'un compte
    // rattaché à une pharmacie reçoive une réponse consolidée mise en cache.
    const perimetre = parUtilisateur
      ? `|${
          req.utilisateur?.superAdmin
            ? 'admin'
            : req.utilisateur?.porteeGlobale
              ? 'global'
              : (req.utilisateur?.pointVenteId ?? 'sans-point')
        }`
      : '';
    const cle = `${req.originalUrl}${perimetre}`;
    const entree = cache.lire(cle);

    // Le cache est côté serveur : le navigateur ne doit JAMAIS réutiliser la
    // réponse, sinon un écran pourrait rester périmé pendant tout le TTL alors
    // que le temps réel vient de signaler un changement.
    const entetes = { 'Cache-Control': 'no-store' };

    if (entree) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', entetes['Cache-Control']);
      return res.status(200).json(entree);
    }

    const jsonOrigine = res.json.bind(res);
    res.json = (corps) => {
      if (res.statusCode === 200) {
        cache.ecrire(cle, corps);
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('Cache-Control', entetes['Cache-Control']);
      }
      return jsonOrigine(corps);
    };

    return next();
  };
}

/** Statistiques du cache (supervision). */
export const statistiquesReponses = () => cache.stats();
