
// Service Permissions : lecture du catalogue (les permissions sont définies
// par les scripts SQL du module, elles ne sont pas créées via l'API).

import { query } from '../../config/database.js';

/** Liste le catalogue des permissions, regroupé par module. */
export async function listerPermissions({ module, recherche, action } = {}) {
  const conditions = [];
  const parametres = [];

  if (module) {
    parametres.push(module);
    conditions.push(`p.module = $${parametres.length}`);
  }
  if (action) {
    parametres.push(action);
    conditions.push(`p.action = $${parametres.length}`);
  }
  if (recherche) {
    parametres.push(`%${recherche}%`);
    const i = parametres.length;
    conditions.push(`(p.code ILIKE $${i} OR p.nom ILIKE $${i} OR p.description ILIKE $${i})`);
  }

  const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT p.id, p.code, p.module, p.ressource, p.action, p.nom, p.description
     FROM permissions p
     ${clauseWhere}
     ORDER BY p.module ASC, p.ressource ASC, p.action ASC`,
    parametres
  );

  const permissions = rows.map((ligne) => ({
    id: ligne.id,
    code: ligne.code,
    module: ligne.module,
    ressource: ligne.ressource,
    action: ligne.action,
    nom: ligne.nom,
    description: ligne.description,
  }));

  // Regroupement par module pour l'affichage (matrice de droits)
  const parModule = new Map();
  for (const permission of permissions) {
    if (!parModule.has(permission.module)) {
      parModule.set(permission.module, []);
    }
    parModule.get(permission.module).push(permission);
  }

  return {
    total: permissions.length,
    modules: [...parModule.entries()].map(([nomModule, liste]) => ({
      module: nomModule,
      nbPermissions: liste.length,
      permissions: liste,
    })),
    permissions,
  };
}

/** Liste simplement les modules disponibles (pour les filtres du frontend). */
export async function listerModules() {
  const { rows } = await query(
    `SELECT module, count(*)::int AS nb_permissions
     FROM permissions
     GROUP BY module
     ORDER BY module`
  );
  return rows;
}