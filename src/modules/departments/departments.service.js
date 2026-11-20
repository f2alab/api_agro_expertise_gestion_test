
// Service Départements : organigramme du groupe (directions, services,
// succursales, unités). La hiérarchie est portée par parent_id ; le chemin
// matérialisé et le niveau sont recalculés par la fonction SQL dédiée.

import { query, transaction } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';

const TYPES_UNITE = ['DIRECTION', 'DEPARTEMENT', 'SERVICE', 'SUCCURSALE', 'UNITE'];

/**
 * Recalcule chemin + niveau de tous les départements.
 * À appeler après toute modification de la hiérarchie.
 */
async function recalculerChemins(client = null) {
  const executeur = client ?? { query };
  await executeur.query(`
    UPDATE departements d
    SET chemin = a.chemin, niveau = a.niveau
    FROM fn_arbre_departements() a
    WHERE a.id = d.id
  `);
}

/** Transforme une ligne SQL en objet API. */
function serialiserDepartement(ligne) {
  return {
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    description: ligne.description ?? null,
    parentId: ligne.parent_id,
    chemin: ligne.chemin,
    niveau: ligne.niveau,
    typeUnite: ligne.type_unite,
    ville: ligne.ville ?? null,
    ordre: ligne.ordre ?? 0,
    actif: Boolean(ligne.actif),
    effectif: ligne.effectif ?? 0,
    nbRoles: ligne.nb_roles ?? 0,
    enfants: [],
  };
}

/** Construit récursivement l'arborescence à partir d'une liste plate. */
function construireArbre(departements) {
  const index = new Map(departements.map((departement) => [departement.id, departement]));
  const racines = [];

  for (const departement of departements) {
    if (departement.parentId && index.has(departement.parentId)) {
      index.get(departement.parentId).enfants.push(departement);
    } else {
      racines.push(departement);
    }
  }

  const trier = (liste) => {
    liste.sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'));
    liste.forEach((element) => trier(element.enfants));
  };
  trier(racines);

  return racines;
}

/** Le SELECT commun (vue arbre + colonnes de la table). */
const SELECT_DEPARTEMENT = `
  SELECT a.id, a.code, a.nom, a.parent_id, a.chemin, a.niveau, a.type_unite, a.ville,
         a.actif, a.effectif, d.description, d.ordre,
         (SELECT count(*)::int FROM roles ro WHERE ro.departement_id = a.id) AS nb_roles
  FROM fn_arbre_departements() a
  JOIN departements d ON d.id = a.id
`;

/** Liste l'organigramme complet sous forme d'arbre + version plate. */
export async function listerOrganigramme({ inclureInactifs = true } = {}) {
  const { rows } = await query(
    `${SELECT_DEPARTEMENT}
     ${inclureInactifs ? '' : 'WHERE a.actif = TRUE'}
     ORDER BY a.chemin`
  );

  const departements = rows.map(serialiserDepartement);
  return {
    arbre: construireArbre(departements),
    liste: departements,
    total: departements.length,
  };
}

/** Récupère un département ou null. */
export async function obtenirDepartement(id) {
  const { rows } = await query(`${SELECT_DEPARTEMENT} WHERE a.id = $1`, [id]);
  return rows[0] ? serialiserDepartement(rows[0]) : null;
}

/** Récupère un département ou lève une 404. */
export async function exigerDepartement(id) {
  const departement = await obtenirDepartement(id);
  if (!departement) {
    throw ApiError.notFound('Département introuvable.', 'DEPARTEMENT_INTROUVABLE');
  }
  return departement;
}

/** Crée un département (direction, service, succursale, unité). */
export async function creerDepartement(donnees) {
  const code = donnees.code.trim().toUpperCase();

  const { rowCount } = await query('SELECT 1 FROM departements WHERE upper(code) = $1', [code]);
  if (rowCount > 0) {
    throw ApiError.conflict(
      'Un département utilise déjà ce code.',
      'CODE_DEPARTEMENT_DEJA_UTILISE',
      { champ: 'code' }
    );
  }

  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO departements (code, nom, description, parent_id, type_unite, ville, ordre, actif)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        code,
        donnees.nom.trim(),
        donnees.description ?? null,
        donnees.parentId ?? null,
        donnees.typeUnite ?? 'SERVICE',
        donnees.ville ?? null,
        donnees.ordre ?? 0,
        donnees.actif ?? true,
      ]
    );
    await recalculerChemins(client);
    return rows[0].id;
  });

  return obtenirDepartement(id);
}

/** Met à jour un département en empêchant les cycles hiérarchiques. */
export async function modifierDepartement(id, donnees) {
  const existant = await exigerDepartement(id);

  if (donnees.code) {
    const { rowCount } = await query(
      'SELECT 1 FROM departements WHERE upper(code) = upper($1) AND id <> $2',
      [donnees.code.trim(), id]
    );
    if (rowCount > 0) {
      throw ApiError.conflict(
        'Un département utilise déjà ce code.',
        'CODE_DEPARTEMENT_DEJA_UTILISE',
        { champ: 'code' }
      );
    }
  }

  // Un département ne peut pas devenir enfant de lui-même ou d'un descendant
  if (donnees.parentId) {
    if (donnees.parentId === id) {
      throw ApiError.badRequest(
        'Un département ne peut pas être son propre parent.',
        'HIERARCHIE_INVALIDE'
      );
    }
    const parent = await obtenirDepartement(donnees.parentId);
    if (!parent) {
      throw ApiError.badRequest('Le département parent est introuvable.', 'PARENT_INTROUVABLE');
    }
    if (parent.chemin.startsWith(existant.chemin)) {
      throw ApiError.badRequest(
        'Un département ne peut pas être rattaché à l’un de ses descendants.',
        'HIERARCHIE_INVALIDE'
      );
    }
  }

  const champs = [];
  const valeurs = [];
  const ajouterChamp = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.code !== undefined) ajouterChamp('code', donnees.code.trim().toUpperCase());
  if (donnees.nom !== undefined) ajouterChamp('nom', donnees.nom.trim());
  if (donnees.description !== undefined) ajouterChamp('description', donnees.description || null);
  if (donnees.parentId !== undefined) ajouterChamp('parent_id', donnees.parentId);
  if (donnees.typeUnite !== undefined) ajouterChamp('type_unite', donnees.typeUnite);
  if (donnees.ville !== undefined) ajouterChamp('ville', donnees.ville || null);
  if (donnees.ordre !== undefined) ajouterChamp('ordre', donnees.ordre);
  if (donnees.actif !== undefined) ajouterChamp('actif', donnees.actif);

  await transaction(async (client) => {
    if (champs.length > 0) {
      valeurs.push(id);
      await client.query(
        `UPDATE departements SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
        valeurs
      );
    }
    await recalculerChemins(client);
  });

  return obtenirDepartement(id);
}

/** Supprime un département vide (sans enfant, utilisateur ni rôle rattaché). */
export async function supprimerDepartement(id) {
  const departement = await exigerDepartement(id);

  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM departements WHERE parent_id = $1) AS enfants,
       (SELECT count(*)::int FROM utilisateurs WHERE departement_id = $1) AS utilisateurs,
       (SELECT count(*)::int FROM roles WHERE departement_id = $1) AS roles`,
    [id]
  );
  const dependances = rows[0];

  if (dependances.enfants > 0) {
    throw ApiError.conflict(
      'Ce département possède des sous-structures. Réaffectez-les ou supprimez-les d’abord.',
      'DEPARTEMENT_AVEC_ENFANTS',
      dependances
    );
  }
  if (dependances.utilisateurs > 0 || dependances.roles > 0) {
    throw ApiError.conflict(
      'Ce département est encore utilisé par des utilisateurs ou des rôles.',
      'DEPARTEMENT_UTILISE',
      dependances
    );
  }

  await transaction(async (client) => {
    await client.query('DELETE FROM departements WHERE id = $1', [id]);
    await recalculerChemins(client);
  });

  return { id, code: departement.code, supprime: true };
}

/** Liste les utilisateurs rattachés au département et à ses sous-structures. */
export async function listerUtilisateursDuDepartement(id) {
  const departement = await exigerDepartement(id);

  const { rows } = await query(
    `SELECT u.id, u.matricule, u.nom, u.prenom, u.email, u.fonction, u.statut,
            d.code AS departement_code, d.nom AS departement_nom
     FROM utilisateurs u
     LEFT JOIN departements d ON d.id = u.departement_id
     WHERE d.chemin LIKE $1 || '%'
     ORDER BY u.nom, u.prenom`,
    [departement.chemin]
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    matricule: ligne.matricule,
    nomComplet: `${ligne.nom} ${ligne.prenom}`,
    email: ligne.email,
    fonction: ligne.fonction,
    statut: ligne.statut,
    departement: ligne.departement_code
      ? { code: ligne.departement_code, nom: ligne.departement_nom }
      : null,
  }));
}

export { TYPES_UNITE };