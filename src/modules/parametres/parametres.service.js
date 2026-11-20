// Service des parametres applicatifs (cle / valeur JSONB).
//
// Deux points d'entree internes sont utilises par les modules metier :
//   * lireParametre(cle, defaut) : lit un reglage (booleen le plus souvent) ;
//   * lireParametreBooleen(...)  : variante directement booleenne.
// L'ecriture est reservee aux profils habilites (permission `parametres.systeme.update`).
//
// Les reglages d'affichage discret (`affichage.discret.*`) sont a part :
// ils ne pilotent que la presentation cote frontend et leur modification est
// reservee a la Direction Generale (permission `parametres.affichage.update`).

import { query } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';

/** Prefixe des reglages d'affichage discret (montants masques a l'ecran). */
export const PREFIXE_AFFICHAGE_DISCRET = 'affichage.discret.';

/** Cle du facteur de reduction applique aux montants affiches. */
export const CLE_FACTEUR_AFFICHAGE_DISCRET = `${PREFIXE_AFFICHAGE_DISCRET}facteur`;

/**
 * Bornes acceptees pour le facteur de reduction. La borne haute (1) interdit
 * d'afficher plus que les montants reels ; la borne basse evite un facteur nul
 * qui afficherait « 0 F » partout.
 */
export const FACTEUR_AFFICHAGE_MIN = 0.001;
export const FACTEUR_AFFICHAGE_MAX = 1;

/** Vrai si la cle fait partie des reglages d'affichage discret. */
export function estCleAffichageDiscret(cle) {
  return typeof cle === 'string' && cle.startsWith(PREFIXE_AFFICHAGE_DISCRET);
}

/** Vrai si la valeur recue est un facteur de reduction exploitable. */
export function estFacteurAffichageValide(valeur) {
  return (
    typeof valeur === 'number' &&
    Number.isFinite(valeur) &&
    valeur >= FACTEUR_AFFICHAGE_MIN &&
    valeur <= FACTEUR_AFFICHAGE_MAX
  );
}

/** Transforme une ligne SQL en objet API. */
function serialiserParametre(ligne) {
  return {
    cle: ligne.cle,
    valeur: ligne.valeur,
    categorie: ligne.categorie,
    libelle: ligne.libelle,
    description: ligne.description ?? null,
    typeValeur: ligne.type_valeur,
    public: ligne.public,
    modifieParNom: ligne.modifie_par_nom ?? null,
    modifieLe: ligne.modifie_le ?? null,
  };
}

const SELECT_PARAMETRE = `
  SELECT p.cle, p.valeur, p.categorie, p.libelle, p.description, p.type_valeur,
         p.public, p.modifie_le,
         (u.nom || ' ' || u.prenom) AS modifie_par_nom
  FROM parametres p
  LEFT JOIN utilisateurs u ON u.id = p.modifie_par
`;

/**
 * Liste des parametres (administration).
 * Les reglages d'affichage discret sont exclus pour les profils qui n'ont pas
 * le droit de les gerer : inutiles pour eux et sans interet a etre divulgues.
 */
export async function listerParametres({ inclureAffichageDiscret = false } = {}) {
  const { rows } = await query(
    `${SELECT_PARAMETRE}${inclureAffichageDiscret ? '' : ' WHERE p.cle NOT LIKE $1'}
     ORDER BY p.categorie, p.cle`,
    inclureAffichageDiscret ? [] : [`${PREFIXE_AFFICHAGE_DISCRET}%`]
  );
  return rows.map(serialiserParametre);
}

/**
 * Parametres publics : objet { cle: valeur } lisible par tout profil
 * authentifie (les ecrans metier connaissent un reglage sans y acceder).
 */
export async function lireParametresPublics() {
  const { rows } = await query('SELECT cle, valeur FROM parametres WHERE public = TRUE ORDER BY cle');
  return Object.fromEntries(rows.map((ligne) => [ligne.cle, ligne.valeur]));
}

/**
 * Lit la valeur d'un parametre (ou une valeur par defaut s'il n'existe pas).
 * Utilisable dans une transaction existante via le client pg.
 */
export async function lireParametre(cle, valeurParDefaut = null, client = null) {
  const executer = client ? (texte, parametres) => client.query(texte, parametres) : query;
  const { rows } = await executer('SELECT valeur FROM parametres WHERE cle = $1', [cle]);
  if (!rows[0]) return valeurParDefaut;
  return rows[0].valeur;
}

/** Lit un parametre booleen (defaut TRUE si absent). */
export async function lireParametreBooleen(cle, defaut = true, client = null) {
  const valeur = await lireParametre(cle, defaut, client);
  if (typeof valeur === 'boolean') return valeur;
  if (typeof valeur === 'string') return valeur.toLowerCase() === 'true';
  return Boolean(valeur);
}

/**
 * Modifie la valeur d'un parametre. Leve 404 si la cle n'existe pas.
 * Le facteur d'affichage discret est verifie : une valeur hors bornes
 * afficherait des montants incoherents sur tous les ecrans.
 */
export async function ecrireParametre(cle, valeur, utilisateurId = null) {
  if (cle === CLE_FACTEUR_AFFICHAGE_DISCRET && !estFacteurAffichageValide(valeur)) {
    throw ApiError.badRequest(
      'Facteur de reduction invalide.',
      'FACTEUR_INVALIDE',
      [
        {
          champ: 'valeur',
          message: `Nombre attendu entre ${FACTEUR_AFFICHAGE_MIN} et ${FACTEUR_AFFICHAGE_MAX}.`,
        },
      ]
    );
  }

  const { rows } = await query(
    `UPDATE parametres
     SET valeur = $2::jsonb, modifie_par = $3, modifie_le = now()
     WHERE cle = $1
     RETURNING cle`,
    [cle, JSON.stringify(valeur), utilisateurId]
  );
  if (!rows[0]) throw ApiError.notFound('Parametre introuvable.', 'PARAMETRE_INTROUVABLE');

  const detail = await query(`${SELECT_PARAMETRE} WHERE p.cle = $1`, [cle]);
  return serialiserParametre(detail.rows[0]);
}