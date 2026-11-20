// Service des propriétaires d'animaux de la clinique.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { genererNumero } from '../clinique.service.js';

// Fiche propriétaire + statistiques de suivi (animaux, dernière visite).
const SELECT_PROPRIETAIRE = `
  SELECT p.id, p.code, p.nom, p.telephone, p.telephone_secondaire, p.email,
         p.adresse, p.ville, p.type_proprietaire, p.actif, p.notes,
         p.created_at, p.updated_at,
         (SELECT count(*)::int FROM clinique_animaux a WHERE a.proprietaire_id = p.id) AS nb_animaux,
         (SELECT max(c.accueil_le) FROM clinique_consultations c
           WHERE c.proprietaire_id = p.id) AS derniere_visite
  FROM clinique_proprietaires p
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserProprietaire(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    telephone: ligne.telephone ?? null,
    telephoneSecondaire: ligne.telephone_secondaire ?? null,
    email: ligne.email ?? null,
    adresse: ligne.adresse ?? null,
    ville: ligne.ville ?? null,
    typeProprietaire: ligne.type_proprietaire,
    actif: Boolean(ligne.actif),
    notes: ligne.notes ?? null,
    nbAnimaux: ligne.nb_animaux ?? 0,
    derniereVisite: ligne.derniere_visite ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les propriétaires (recherche nom, téléphone, e-mail, code). */
export async function listerProprietaires(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(p.nom ILIKE $${i} OR p.telephone ILIKE $${i} OR p.email ILIKE $${i} OR p.code ILIKE $${i})`
    );
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`p.actif = $${parametres.length}`);
  }
  if (filtres.typeProprietaire) {
    parametres.push(filtres.typeProprietaire);
    conditions.push(`p.type_proprietaire = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const tri = filtres.ordre === 'recent' ? 'p.created_at DESC' : 'p.nom ASC';
  const { rows } = await query(`${SELECT_PROPRIETAIRE} ${clause} ORDER BY ${tri} LIMIT 500`, parametres);
  return rows.map(serialiserProprietaire);
}

/** Récupère un propriétaire ou null. */
export async function obtenirProprietaire(id) {
  const { rows } = await query(`${SELECT_PROPRIETAIRE} WHERE p.id = $1`, [id]);
  return rows[0] ? serialiserProprietaire(rows[0]) : null;
}

/** Récupère un propriétaire ou lève une 404. */
export async function exigerProprietaire(id) {
  const proprietaire = await obtenirProprietaire(id);
  if (!proprietaire) {
    throw ApiError.notFound('Propriétaire introuvable.', 'PROPRIETAIRE_INTROUVABLE');
  }
  return proprietaire;
}

/** Crée un propriétaire (code attribué automatiquement). */
export async function creerProprietaire(donnees, utilisateur = null) {
  const code = await genererNumero('PROP', { avecAnnee: false });

  const { rows } = await query(
    `INSERT INTO clinique_proprietaires
       (code, nom, telephone, telephone_secondaire, email, adresse, ville,
        type_proprietaire, notes, actif, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      code,
      donnees.nom.trim(),
      donnees.telephone ?? null,
      donnees.telephoneSecondaire ?? null,
      donnees.email ?? null,
      donnees.adresse ?? null,
      donnees.ville ?? null,
      donnees.typeProprietaire ?? 'PARTICULIER',
      donnees.notes ?? null,
      donnees.actif ?? true,
      utilisateur?.id ?? null,
    ]
  );

  return obtenirProprietaire(rows[0].id);
}

/** Modifie partiellement un propriétaire. */
export async function modifierProprietaire(id, donnees) {
  await exigerProprietaire(id);

  const champs = [];
  const valeurs = [];
  const ajouter = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.nom !== undefined) ajouter('nom', donnees.nom.trim());
  if (donnees.telephone !== undefined) ajouter('telephone', donnees.telephone || null);
  if (donnees.telephoneSecondaire !== undefined) {
    ajouter('telephone_secondaire', donnees.telephoneSecondaire || null);
  }
  if (donnees.email !== undefined) ajouter('email', donnees.email || null);
  if (donnees.adresse !== undefined) ajouter('adresse', donnees.adresse || null);
  if (donnees.ville !== undefined) ajouter('ville', donnees.ville || null);
  if (donnees.typeProprietaire !== undefined) ajouter('type_proprietaire', donnees.typeProprietaire);
  if (donnees.notes !== undefined) ajouter('notes', donnees.notes || null);
  if (donnees.actif !== undefined) ajouter('actif', donnees.actif);

  if (champs.length > 0) {
    valeurs.push(id);
    await query(
      `UPDATE clinique_proprietaires SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
      valeurs
    );
  }

  return obtenirProprietaire(id);
}

/** Désactive un propriétaire (archivage logique : aucun dossier n'est perdu). */
export async function desactiverProprietaire(id) {
  const proprietaire = await exigerProprietaire(id);
  await query('UPDATE clinique_proprietaires SET actif = FALSE WHERE id = $1', [id]);
  return { id, code: proprietaire.code, nom: proprietaire.nom, actif: false };
}