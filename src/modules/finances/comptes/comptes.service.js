// Service des comptes de paiement (mobile money / banque).

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { perimetreUtilisateur } from '../../../utils/perimetre.js';

const SELECT_COMPTE = `
  SELECT c.id, c.type, c.prestataire, c.libelle, c.numero, c.titulaire, c.point_id,
         po.nom AS point_nom, c.actif, c.created_at, c.updated_at
  FROM finance_comptes c
  LEFT JOIN pharmacie_points po ON po.id = c.point_id
`;

/** Transforme une ligne SQL en objet JSON destine a l'API. */
function serialiser(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    type: ligne.type,
    prestataire: ligne.prestataire,
    libelle: ligne.libelle ?? null,
    numero: ligne.numero,
    titulaire: ligne.titulaire ?? null,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    actif: Boolean(ligne.actif),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les comptes de paiement (filtrable). */
export async function listerComptes(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.type) {
    parametres.push(filtres.type);
    conditions.push(`c.type = $${parametres.length}`);
  }
  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`c.point_id = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`c.actif = $${parametres.length}`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(c.prestataire ILIKE $${i} OR c.libelle ILIKE $${i} OR c.numero ILIKE $${i} OR c.titulaire ILIKE $${i})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_COMPTE} ${clause} ORDER BY c.type, c.prestataire, c.libelle`,
    parametres
  );
  return rows.map(serialiser);
}

/**
 * Comptes utilisables par le profil connecté pour un moyen de paiement donné.
 *  - compte global     : tous les comptes actifs (filtrable par point) ;
 *  - compte cloisonné  : les comptes de SA pharmacie + les comptes du groupe.
 * Aucune information sur les autres pharmacies n'est exposée.
 */
export async function listerComptesDisponibles(utilisateur, filtres = {}) {
  const perimetre = perimetreUtilisateur(utilisateur);

  const conditions = ['c.actif = TRUE'];
  const parametres = [];

  if (filtres.type) {
    parametres.push(filtres.type);
    conditions.push(`c.type = $${parametres.length}`);
  }

  if (perimetre.global) {
    if (filtres.pointId) {
      parametres.push(filtres.pointId);
      conditions.push(`(c.point_id = $${parametres.length} OR c.point_id IS NULL)`);
    }
  } else if (perimetre.pointId) {
    parametres.push(perimetre.pointId);
    conditions.push(`(c.point_id = $${parametres.length} OR c.point_id IS NULL)`);
  } else {
    conditions.push('c.point_id IS NULL');
  }

  const { rows } = await query(
    `${SELECT_COMPTE} WHERE ${conditions.join(' AND ')} ORDER BY c.type, c.prestataire, c.libelle`,
    parametres
  );
  return rows.map(serialiser);
}

/** Recupere un compte ou null. */
export async function obtenirCompte(id) {
  const { rows } = await query(`${SELECT_COMPTE} WHERE c.id = $1`, [id]);
  return rows[0] ? serialiser(rows[0]) : null;
}

/** Transforme une ligne de la vue des soldes en objet API. */
function serialiserSolde(ligne) {
  if (!ligne) return null;
  return {
    ...serialiser(ligne),
    fondsDepart: Number(ligne.fonds_depart ?? 0),
    totalEntrees: Number(ligne.total_entrees ?? 0),
    totalSorties: Number(ligne.total_sorties ?? 0),
    solde: Number(ligne.solde ?? 0),
    nbMouvements: Number(ligne.nb_mouvements ?? 0),
  };
}

/** Liste les comptes avec leur solde (fonds de départ, entrées, sorties). */
export async function listerSoldesComptes(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.type) {
    parametres.push(filtres.type);
    conditions.push(`v.type = $${parametres.length}`);
  }
  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`v.point_id = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`c.actif = $${parametres.length}`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(v.prestataire ILIKE $${i} OR v.libelle ILIKE $${i} OR v.numero ILIKE $${i})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT v.compte_id AS id, v.type, v.prestataire, v.libelle, v.numero, v.point_id,
            po.nom AS point_nom, c.titulaire, c.actif, c.created_at, c.updated_at,
            v.fonds_depart, v.total_entrees, v.total_sorties, v.solde, v.nb_mouvements
     FROM v_finance_solde_compte v
     JOIN finance_comptes c ON c.id = v.compte_id
     LEFT JOIN pharmacie_points po ON po.id = v.point_id
     ${clause}
     ORDER BY v.type, v.prestataire, v.libelle`,
    parametres
  );
  return rows.map(serialiserSolde);
}

/** Recupere un compte ou leve une 404. */
export async function exigerCompte(id) {
  const compte = await obtenirCompte(id);
  if (!compte) throw ApiError.notFound('Compte de paiement introuvable.', 'COMPTE_INTROUVABLE');
  return compte;
}

/** Cree un compte de paiement. */
export async function creerCompte(donnees) {
  if (donnees.pointId) {
    const point = await query('SELECT 1 FROM pharmacie_points WHERE id = $1', [donnees.pointId]);
    if (point.rowCount === 0) throw ApiError.notFound('Point de vente introuvable.', 'POINT_INTROUVABLE');
  }

  const { rows } = await query(
    `INSERT INTO finance_comptes (type, prestataire, libelle, numero, titulaire, point_id, actif)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      donnees.type,
      donnees.prestataire.trim(),
      donnees.libelle ?? null,
      donnees.numero.trim(),
      donnees.titulaire ?? null,
      donnees.pointId ?? null,
      donnees.actif ?? true,
    ]
  );
  return obtenirCompte(rows[0].id);
}

const CORRESPONDANCES = {
  prestataire: 'prestataire',
  libelle: 'libelle',
  numero: 'numero',
  titulaire: 'titulaire',
  pointId: 'point_id',
  actif: 'actif',
};

/** Modifie partiellement un compte de paiement. */
export async function modifierCompte(id, donnees) {
  await exigerCompte(id);

  const champs = [];
  const valeurs = [];
  for (const [cle, colonne] of Object.entries(CORRESPONDANCES)) {
    if (donnees[cle] === undefined) continue;
    let valeur = donnees[cle];
    if (cle === 'prestataire' || cle === 'numero') valeur = String(valeur).trim();
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  }

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE finance_comptes SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }
  return obtenirCompte(id);
}

/** Desactive (suppression logique) un compte de paiement. */
export async function desactiverCompte(id) {
  const compte = await exigerCompte(id);
  await query('UPDATE finance_comptes SET actif = FALSE WHERE id = $1', [id]);
  return { id, prestataire: compte.prestataire, numero: compte.numero, actif: false };
}