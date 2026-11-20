// Service des référentiels du module Clinique.
// Nomenclatures paramétrables : espèces, races, motifs de consultation,
// organes examinés et types d'examen paraclinique.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';

const SELECT_REFERENTIEL = `
  SELECT r.id, r.type, r.code, r.libelle, r.parent_id, r.ordre, r.actif,
         r.created_at, r.updated_at,
         (SELECT p.libelle FROM clinique_referentiels p WHERE p.id = r.parent_id) AS parent_libelle
  FROM clinique_referentiels r
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserReferentiel(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    type: ligne.type,
    code: ligne.code,
    libelle: ligne.libelle,
    parentId: ligne.parent_id ?? null,
    parentLibelle: ligne.parent_libelle ?? null,
    ordre: ligne.ordre,
    actif: Boolean(ligne.actif),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les entrées d'un ou plusieurs référentiels. */
export async function listerReferentiels(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.type) {
    parametres.push(filtres.type);
    conditions.push(`r.type = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`r.actif = $${parametres.length}`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(r.libelle ILIKE $${i} OR r.code ILIKE $${i})`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_REFERENTIEL} ${clause} ORDER BY r.type, r.ordre, r.libelle`,
    parametres
  );
  return rows.map(serialiserReferentiel);
}

/** Récupère une entrée ou null. */
export async function obtenirReferentiel(id) {
  const { rows } = await query(`${SELECT_REFERENTIEL} WHERE r.id = $1`, [id]);
  return rows[0] ? serialiserReferentiel(rows[0]) : null;
}

/** Récupère une entrée ou lève une 404. */
export async function exigerReferentiel(id) {
  const referentiel = await obtenirReferentiel(id);
  if (!referentiel) {
    throw ApiError.notFound('Entrée de référentiel introuvable.', 'REFERENTIEL_INTROUVABLE');
  }
  return referentiel;
}

/** Vrai si l'erreur PostgreSQL signale une violation d'unicité. */
function estDoublon(erreur) {
  return erreur && erreur.code === '23505';
}

/** Crée une entrée de référentiel. */
export async function creerReferentiel(donnees) {
  try {
    const { rows } = await query(
      `INSERT INTO clinique_referentiels (type, code, libelle, parent_id, ordre, actif)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        donnees.type,
        donnees.code.trim().toUpperCase(),
        donnees.libelle.trim(),
        donnees.parentId ?? null,
        donnees.ordre ?? 0,
        donnees.actif ?? true,
      ]
    );
    return obtenirReferentiel(rows[0].id);
  } catch (erreur) {
    if (estDoublon(erreur)) {
      throw ApiError.conflict(
        'Ce code existe déjà pour ce type de référentiel.',
        'REFERENTIEL_EXISTANT',
        { code: donnees.code }
      );
    }
    throw erreur;
  }
}

/** Modifie partiellement une entrée de référentiel. */
export async function modifierReferentiel(id, donnees) {
  await exigerReferentiel(id);

  const champs = [];
  const valeurs = [];
  const ajouter = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.libelle !== undefined) ajouter('libelle', donnees.libelle.trim());
  if (donnees.parentId !== undefined) ajouter('parent_id', donnees.parentId);
  if (donnees.ordre !== undefined) ajouter('ordre', donnees.ordre);
  if (donnees.actif !== undefined) ajouter('actif', donnees.actif);

  if (champs.length > 0) {
    valeurs.push(id);
    await query(
      `UPDATE clinique_referentiels SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
      valeurs
    );
  }
  return obtenirReferentiel(id);
}