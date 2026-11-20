// Service des points de vente de la pharmacie (siege et succursales).
// Chaque point possede son propre stock et son propre parametrage produits.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { assurerFournisseurPrincipal } from '../fournisseurs/fournisseurs.service.js';

// Colonnes exposees par l'API (departement et responsable resolus a la lecture)
const SELECT_POINT = `
  SELECT p.id, p.code, p.nom, p.departement_id, p.type_point, p.ville, p.adresse,
         p.telephone, p.email, p.responsable_id, p.devise, p.actif,
         p.created_at, p.updated_at,
         d.code AS departement_code, d.nom AS departement_nom,
         (u.nom || ' ' || u.prenom) AS responsable_nom
  FROM pharmacie_points p
  LEFT JOIN departements d ON d.id = p.departement_id
  LEFT JOIN utilisateurs u ON u.id = p.responsable_id
`;

/** Transforme une ligne SQL en objet JSON destine a l'API. */
export function serialiserPoint(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    typePoint: ligne.type_point,
    ville: ligne.ville ?? null,
    adresse: ligne.adresse ?? null,
    telephone: ligne.telephone ?? null,
    email: ligne.email ?? null,
    devise: ligne.devise,
    actif: Boolean(ligne.actif),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
    departement: ligne.departement_id
      ? { id: ligne.departement_id, code: ligne.departement_code, nom: ligne.departement_nom }
      : null,
    responsable: ligne.responsable_id
      ? { id: ligne.responsable_id, nomComplet: ligne.responsable_nom }
      : null,
  };
}

/** Liste les points de vente (le siege en tete). */
export async function listerPoints(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    conditions.push(`(p.nom ILIKE $${parametres.length} OR p.code ILIKE $${parametres.length})`);
  }
  if (filtres.typePoint) {
    parametres.push(filtres.typePoint);
    conditions.push(`p.type_point = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`p.actif = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_POINT} ${clause}
     ORDER BY CASE p.type_point WHEN 'SIEGE' THEN 0 ELSE 1 END, p.nom`,
    parametres
  );
  return rows.map(serialiserPoint);
}

/** Recupere un point ou null. */
export async function obtenirPoint(id) {
  const { rows } = await query(`${SELECT_POINT} WHERE p.id = $1`, [id]);
  return rows[0] ? serialiserPoint(rows[0]) : null;
}

/** Recupere un point ou leve une 404. */
export async function exigerPoint(id) {
  const point = await obtenirPoint(id);
  if (!point) throw ApiError.notFound('Point de vente introuvable.', 'POINT_INTROUVABLE');
  return point;
}

/** Cree un point de vente. */
export async function creerPoint(donnees) {
  const { rows } = await query(
    `INSERT INTO pharmacie_points
       (code, nom, departement_id, type_point, ville, adresse, telephone, email, responsable_id, devise, actif)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      donnees.code.trim().toUpperCase(),
      donnees.nom.trim(),
      donnees.departementId ?? null,
      donnees.typePoint ?? 'SUCCURSALE',
      donnees.ville ?? null,
      donnees.adresse ?? null,
      donnees.telephone ?? null,
      donnees.email ?? null,
      donnees.responsableId ?? null,
      donnees.devise ?? 'XOF',
      donnees.actif ?? true,
    ]
  );
  const point = await obtenirPoint(rows[0].id);
  // Une succursale recoit automatiquement son fournisseur principal
  // « Pharmacie du Siège » (les autres points n'en ont pas besoin).
  await assurerFournisseurPrincipal(point.id);
  return point;
}

/** Modifie partiellement un point de vente. */
export async function modifierPoint(id, donnees) {
  await exigerPoint(id);

  const champs = [];
  const valeurs = [];
  const ajouter = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.code !== undefined) ajouter('code', donnees.code.trim().toUpperCase());
  if (donnees.nom !== undefined) ajouter('nom', donnees.nom.trim());
  if (donnees.departementId !== undefined) ajouter('departement_id', donnees.departementId);
  if (donnees.typePoint !== undefined) ajouter('type_point', donnees.typePoint);
  if (donnees.ville !== undefined) ajouter('ville', donnees.ville || null);
  if (donnees.adresse !== undefined) ajouter('adresse', donnees.adresse || null);
  if (donnees.telephone !== undefined) ajouter('telephone', donnees.telephone || null);
  if (donnees.email !== undefined) ajouter('email', donnees.email || null);
  if (donnees.responsableId !== undefined) ajouter('responsable_id', donnees.responsableId);
  if (donnees.devise !== undefined) ajouter('devise', donnees.devise);
  if (donnees.actif !== undefined) ajouter('actif', donnees.actif);

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE pharmacie_points SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }
  const point = await obtenirPoint(id);
  // Le point peut devenir une succursale (ou voir son code change) : on remet
  // a niveau son fournisseur principal sans toucher a ses autres fournisseurs.
  if (point.typePoint === 'SUCCURSALE') await assurerFournisseurPrincipal(point.id);
  return point;
}

/** Desactive un point de vente (archivage logique). */
export async function desactiverPoint(id) {
  const point = await exigerPoint(id);
  await query('UPDATE pharmacie_points SET actif = FALSE WHERE id = $1', [id]);
  return { id, code: point.code, nom: point.nom, actif: false };
}
