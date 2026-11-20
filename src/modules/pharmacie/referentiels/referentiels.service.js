// Service des referentiels produits : categories, unites de mesure et rayons.
// Chaque element est un couple (type, code) avec un libelle affiche dans l'UI.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';

const COLONNES = `id, type, code, libelle, description, actif, created_at, updated_at`;

/** Transforme une ligne SQL en objet JSON destine a l'API. */
function serialiser(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    type: ligne.type,
    code: ligne.code,
    libelle: ligne.libelle,
    description: ligne.description ?? null,
    actif: Boolean(ligne.actif),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les referentiels (filtrable par type, statut, recherche). */
export async function listerReferentiels(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.type) {
    parametres.push(filtres.type);
    conditions.push(`type = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`actif = $${parametres.length}`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(code ILIKE $${i} OR libelle ILIKE $${i})`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ${COLONNES} FROM pharmacie_referentiels ${clause}
     ORDER BY type, code`,
    parametres
  );
  return rows.map(serialiser);
}

/** Recupere un referentiel ou null. */
export async function obtenirReferentiel(id) {
  const { rows } = await query(`SELECT ${COLONNES} FROM pharmacie_referentiels WHERE id = $1`, [id]);
  return rows[0] ? serialiser(rows[0]) : null;
}

/** Recupere un referentiel ou leve une 404. */
export async function exigerReferentiel(id) {
  const referentiel = await obtenirReferentiel(id);
  if (!referentiel) throw ApiError.notFound('Referentiel introuvable.', 'REFERENTIEL_INTROUVABLE');
  return referentiel;
}

/** Prefixe et longueur de la sequence du code, par type de referentiel. */
const PREFIXES = {
  CATEGORIE: { prefixe: 'CAT', longueur: 3 },
  UNITE: { prefixe: 'UN', longueur: 3 },
  RAYON: { prefixe: 'RAY', longueur: 3 },
  FORME: { prefixe: 'FORM', longueur: 3 },
};

/** Genere le prochain code disponible pour un type (CAT001, UN001, RAY001...). */
async function genererCode(type) {
  const { prefixe, longueur } = PREFIXES[type];
  const { rows } = await query(
    `SELECT COALESCE(MAX((substring(code from '[0-9]+$'))::int), 0) AS maximum
     FROM pharmacie_referentiels
     WHERE type = $1 AND code ~ $2`,
    [type, `^${prefixe}[0-9]+$`]
  );
  const suivant = (rows[0]?.maximum ?? 0) + 1;
  return `${prefixe}${String(suivant).padStart(longueur, '0')}`;
}

/** Cree un referentiel ; le code est genere automatiquement. */
export async function creerReferentiel(donnees) {
  // Quelques tentatives en cas de collision de code (creations simultanees).
  for (let tentative = 0; tentative < 5; tentative += 1) {
    const code = await genererCode(donnees.type);
    try {
      const { rows } = await query(
        `INSERT INTO pharmacie_referentiels (type, code, libelle, description)
         VALUES ($1,$2,$3,$4)
         RETURNING id`,
        [donnees.type, code, donnees.libelle.trim(), donnees.description ?? null]
      );
      return obtenirReferentiel(rows[0].id);
    } catch (erreur) {
      if (erreur.code === '23505') continue;
      throw erreur;
    }
  }
  throw ApiError.conflict('Impossible de generer un code unique. Reessayez.', 'CODE_NON_GENERE');
}

/** Modifie la designation d'un referentiel (le code n'est pas modifiable). */
export async function modifierReferentiel(id, donnees) {
  await exigerReferentiel(id);

  const champs = [];
  const valeurs = [];
  if (donnees.libelle !== undefined) {
    valeurs.push(donnees.libelle.trim());
    champs.push(`libelle = $${valeurs.length}`);
  }
  if (donnees.description !== undefined) {
    valeurs.push(donnees.description ?? null);
    champs.push(`description = $${valeurs.length}`);
  }

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE pharmacie_referentiels SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }
  return obtenirReferentiel(id);
}

/** Nombre de produits utilisant un referentiel (selon son type). */
async function compterUtilisation(referentiel) {
  const colonne = {
    CATEGORIE: 'categorie',
    UNITE: 'unite_mesure',
    RAYON: 'rayon',
    FORME: 'forme',
  }[referentiel.type];
  const { rows } = await query(
    `SELECT count(*)::int AS total FROM pharmacie_produits WHERE ${colonne} = $1`,
    [referentiel.code]
  );
  return rows[0].total;
}

/** Supprime un referentiel (refuse s'il est encore utilise par des produits). */
export async function supprimerReferentiel(id) {
  const referentiel = await exigerReferentiel(id);
  const nbUtilisations = await compterUtilisation(referentiel);
  if (nbUtilisations > 0) {
    throw ApiError.conflict(
      `Ce referentiel est utilise par ${nbUtilisations} produit(s) ; la suppression est impossible.`,
      'REFERENTIEL_UTILISE'
    );
  }
  await query('DELETE FROM pharmacie_referentiels WHERE id = $1', [id]);
  return { id, supprime: true };
}

/**
 * Verifie qu'un code de referentiel existe et est actif (utilise par les produits).
 * Un code vide / null est accepte (champ facultatif).
 */
export async function verifierCodeReferentiel(type, code, libelle) {
  if (code === undefined || code === null || code === '') return;
  const { rowCount } = await query(
    'SELECT 1 FROM pharmacie_referentiels WHERE type = $1 AND code = $2 AND actif = TRUE',
    [type, code]
  );
  if (rowCount === 0) {
    throw ApiError.badRequest(`${libelle ?? type} inconnu ou inactif : ${code}.`, 'REFERENTIEL_INVALIDE');
  }
}