
// Service Rôles : CRUD des rôles métier et affectation des permissions.
// Un rôle « système » (SUPER_ADMIN) ne peut être ni supprimé ni renommé.

import { query, transaction } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';

const PERMISSIONS_AGREGEES = `
  COALESCE((
    SELECT json_agg(
             json_build_object('id', p.id, 'code', p.code, 'nom', p.nom, 'module', p.module)
             ORDER BY p.code
           )
    FROM roles_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = r.id
  ), '[]'::json) AS permissions
`;

const COLONNES_ROLE = `
  r.id, r.code, r.nom, r.description, r.niveau, r.systeme, r.actif,
  r.created_at, r.updated_at, r.departement_id,
  d.code AS departement_code, d.nom AS departement_nom
`;

/** Normalise une ligne SQL de rôle pour l'API. */
function serialiserRole(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    description: ligne.description ?? null,
    niveau: ligne.niveau,
    systeme: Boolean(ligne.systeme),
    actif: Boolean(ligne.actif),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
    departement: ligne.departement_id
      ? { id: ligne.departement_id, code: ligne.departement_code, nom: ligne.departement_nom }
      : null,
    permissions: ligne.permissions ?? [],
    nbPermissions: (ligne.permissions ?? []).length,
    nbUtilisateurs: ligne.nb_utilisateurs ?? 0,
  };
}

/** Liste les rôles (avec permissions et effectif). */
export async function listerRoles({ recherche, actif } = {}) {
  const conditions = [];
  const parametres = [];

  if (recherche) {
    parametres.push(`%${recherche}%`);
    const i = parametres.length;
    conditions.push(`(r.code ILIKE $${i} OR r.nom ILIKE $${i} OR r.description ILIKE $${i})`);
  }
  if (actif !== undefined) {
    parametres.push(actif === 'true' || actif === true);
    conditions.push(`r.actif = $${parametres.length}`);
  }

  const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT ${COLONNES_ROLE}, ${PERMISSIONS_AGREGEES},
            (SELECT count(*)::int FROM utilisateurs_roles ur WHERE ur.role_id = r.id) AS nb_utilisateurs
     FROM roles r
     LEFT JOIN departements d ON d.id = r.departement_id
     ${clauseWhere}
     ORDER BY r.niveau ASC, r.code ASC`,
    parametres
  );

  return rows.map(serialiserRole);
}

/** Récupère un rôle complet ou null. */
export async function obtenirRole(id) {
  const { rows } = await query(
    `SELECT ${COLONNES_ROLE}, ${PERMISSIONS_AGREGEES},
            (SELECT count(*)::int FROM utilisateurs_roles ur WHERE ur.role_id = r.id) AS nb_utilisateurs
     FROM roles r
     LEFT JOIN departements d ON d.id = r.departement_id
     WHERE r.id = $1`,
    [id]
  );
  return serialiserRole(rows[0]);
}

/** Récupère un rôle ou lève une 404. */
export async function exigerRole(id) {
  const role = await obtenirRole(id);
  if (!role) throw ApiError.notFound('Rôle introuvable.', 'ROLE_INTROUVABLE');
  return role;
}

/** Crée un rôle, éventuellement avec ses permissions. */
export async function creerRole(donnees, acteur) {
  const code = donnees.code.trim().toUpperCase();

  const { rowCount } = await query('SELECT 1 FROM roles WHERE upper(code) = $1', [code]);
  if (rowCount > 0) {
    throw ApiError.conflict('Un rôle utilise déjà ce code.', 'CODE_ROLE_DEJA_UTILISE', {
      champ: 'code',
    });
  }

  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO roles (code, nom, description, departement_id, niveau, actif)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        code,
        donnees.nom.trim(),
        donnees.description ?? null,
        donnees.departementId ?? null,
        donnees.niveau ?? 50,
        donnees.actif ?? true,
      ]
    );

    const nouvelId = rows[0].id;
    if (donnees.permissionIds?.length) {
      await affecterPermissionsDansTransaction(client, nouvelId, donnees.permissionIds);
    }
    return nouvelId;
  });

  return obtenirRole(id);
}

/** Remplace les permissions d'un rôle (transaction). */
async function affecterPermissionsDansTransaction(client, roleId, permissionIds) {
  if (permissionIds.length > 0) {
    const { rows } = await client.query(
      'SELECT id FROM permissions WHERE id = ANY($1::uuid[])',
      [permissionIds]
    );
    if (rows.length !== new Set(permissionIds).size) {
      throw ApiError.badRequest(
        'Une ou plusieurs permissions sont introuvables.',
        'PERMISSION_INVALIDE'
      );
    }
  }

  await client.query('DELETE FROM roles_permissions WHERE role_id = $1', [roleId]);
  if (permissionIds.length === 0) return;

  await client.query(
    `INSERT INTO roles_permissions (role_id, permission_id)
     SELECT $1::uuid, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [roleId, permissionIds]
  );
}

/** Met à jour un rôle existant. */
export async function modifierRole(id, donnees) {
  const role = await exigerRole(id);

  // Les rôles système gardent leur code et restent obligatoirement actifs
  if (role.systeme && donnees.code && donnees.code.trim().toUpperCase() !== role.code) {
    throw ApiError.conflict('Le code d’un rôle système ne peut pas être modifié.', 'ROLE_SYSTEME');
  }
  if (role.systeme && donnees.actif === false) {
    throw ApiError.conflict('Un rôle système ne peut pas être désactivé.', 'ROLE_SYSTEME');
  }

  if (donnees.code) {
    const { rowCount } = await query(
      'SELECT 1 FROM roles WHERE upper(code) = upper($1) AND id <> $2',
      [donnees.code.trim(), id]
    );
    if (rowCount > 0) {
      throw ApiError.conflict('Un rôle utilise déjà ce code.', 'CODE_ROLE_DEJA_UTILISE', {
        champ: 'code',
      });
    }
  }

  const champs = [];
  const valeurs = [];
  const ajouterChamp = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.code !== undefined && !role.systeme) {
    ajouterChamp('code', donnees.code.trim().toUpperCase());
  }
  if (donnees.nom !== undefined) ajouterChamp('nom', donnees.nom.trim());
  if (donnees.description !== undefined) ajouterChamp('description', donnees.description || null);
  if (donnees.departementId !== undefined) ajouterChamp('departement_id', donnees.departementId);
  if (donnees.niveau !== undefined) ajouterChamp('niveau', donnees.niveau);
  if (donnees.actif !== undefined && !role.systeme) ajouterChamp('actif', donnees.actif);

  await transaction(async (client) => {
    if (champs.length > 0) {
      valeurs.push(id);
      await client.query(`UPDATE roles SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
    }
    if (donnees.permissionIds !== undefined) {
      await affecterPermissionsDansTransaction(client, id, donnees.permissionIds);
    }
  });

  return obtenirRole(id);
}

/** Supprime un rôle non système et non utilisé. */
export async function supprimerRole(id) {
  const role = await exigerRole(id);

  if (role.systeme) {
    throw ApiError.conflict('Un rôle système ne peut pas être supprimé.', 'ROLE_SYSTEME');
  }
  if (role.nbUtilisateurs > 0) {
    throw ApiError.conflict(
      `Ce rôle est encore attribué à ${role.nbUtilisateurs} utilisateur(s). Retirez-le d'abord.`,
      'ROLE_UTILISE',
      { nbUtilisateurs: role.nbUtilisateurs }
    );
  }

  await query('DELETE FROM roles WHERE id = $1', [id]);
  return { id, supprime: true };
}

/** Remplace l'ensemble des permissions d'un rôle. */
export async function remplacerPermissions(roleId, permissionIds) {
  await exigerRole(roleId);
  await transaction((client) =>
    affecterPermissionsDansTransaction(client, roleId, permissionIds)
  );
  return obtenirRole(roleId);
}