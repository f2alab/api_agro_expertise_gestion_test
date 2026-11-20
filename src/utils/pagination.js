
// Pagination : lecture des paramètres de requête et format de réponse commun.


const LIMITE_PAR_DEFAUT = 20;
const LIMITE_MAX = 100;

/**
 * Lit page/limite depuis la query string et calcule l'offset SQL.
 * @param {{ page?: string, limite?: string }} query
 */
export function lirePagination(query = {}) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limite = Math.min(Math.max(Number.parseInt(query.limite, 10) || LIMITE_PAR_DEFAUT, 1), LIMITE_MAX);
  return { page, limite, offset: (page - 1) * limite };
}

/** Construit l'enveloppe de réponse paginée utilisée par toute l'API. */
export function reponsePaginee(donnees, total, { page, limite }) {
  const totalPages = Math.max(Math.ceil(total / limite), 1);
  return {
    donnees,
    pagination: {
      page,
      limite,
      total,
      totalPages,
      aSuivante: page < totalPages,
      aPrecedente: page > 1,
    },
  };
}