
// Cache mémoire à durée de vie courte.
//
// Objectif : tenir des centaines d'utilisateurs simultanés en supprimant les
// recalculs redondants (profil/permissions, tableaux de bord agrégés).
//
// Caractéristiques :
//   * entrées à TTL (durée de vie) explicite ;
//   * éviction du plus ancien au-delà de `maximum` entrées (borne mémoire) ;
//   * invalidation ciblée par préfixe de clé (utilisée par le temps réel :
//     un changement de données purge uniquement ce qui le concerne) ;
//   * purge périodique des entrées expirées (le minuteur ne bloque pas l'arrêt).
//
// Chaque instance de cache est locale au processus : en déploiement multi-
// workers, chaque worker possède le sien, ce qui est acceptable pour un cache
// de quelques secondes (aucune cohérence forte n'est requise).

/**
 * @param {object} options
 * @param {string} options.nom            Nom du cache (supervision)
 * @param {number} options.ttlSecondes    Durée de vie des entrées
 * @param {number} [options.maximum]      Nombre maximal d'entrées
 */
export function creerCache({ nom, ttlSecondes, maximum = 10_000 }) {
  const entrees = new Map();
  let lectures = 0;
  let succes = 0;

  const dateExpiration = () => Date.now() + ttlSecondes * 1000;

  /** Lit une entrée (undefined si absente ou expirée). */
  function lire(cle) {
    lectures += 1;
    const entree = entrees.get(cle);
    if (!entree) return undefined;

    if (entree.expireLe <= Date.now()) {
      entrees.delete(cle);
      return undefined;
    }

    // Réinsertion en fin de table : les entrées les plus utilisées survivent
    // à l'éviction lorsque la capacité maximale est atteinte.
    entrees.delete(cle);
    entrees.set(cle, entree);
    succes += 1;
    return entree.valeur;
  }

  /** Écrit une entrée (réinitialise son TTL). */
  function ecrire(cle, valeur) {
    if (entrees.size >= maximum) {
      const plusAncienne = entrees.keys().next().value;
      if (plusAncienne !== undefined) entrees.delete(plusAncienne);
    }
    entrees.set(cle, { valeur, expireLe: dateExpiration() });
  }

  /** Invalide toutes les clés commençant par le préfixe donné. */
  function invaliderParPrefixe(prefixe) {
    let supprimees = 0;
    for (const cle of entrees.keys()) {
      if (String(cle).startsWith(prefixe)) {
        entrees.delete(cle);
        supprimees += 1;
      }
    }
    return supprimees;
  }

  const invaliderTout = () => entrees.clear();

  const stats = () => ({
    nom,
    ttlSecondes,
    entrees: entrees.size,
    maximum,
    lectures,
    tauxSucces: lectures === 0 ? 0 : Number((succes / lectures).toFixed(4)),
  });

  // Purge périodique : évite que des entrées expirées occupent la mémoire
  const purge = setInterval(
    () => {
      const maintenant = Date.now();
      for (const [cle, entree] of entrees) {
        if (entree.expireLe <= maintenant) entrees.delete(cle);
      }
    },
    Math.max(ttlSecondes * 1000, 30_000)
  );
  purge.unref?.();

  return { lire, ecrire, invaliderParPrefixe, invaliderTout, stats };
}
