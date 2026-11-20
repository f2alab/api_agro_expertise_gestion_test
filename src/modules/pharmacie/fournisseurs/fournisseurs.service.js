// Service des fournisseurs de la pharmacie.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { perimetreUtilisateur, resoudrePointId } from '../../../utils/perimetre.js';

// Prefixe et longueur du code fournisseur genere automatiquement (FOUR-0001).
const PREFIXE_CODE = 'FOUR-';
const LONGUEUR_CODE = 4;

// Colonnes exposees (le nom de la pharmacie proprietaire sert a la direction,
// qui voit les fournisseurs de plusieurs pharmacies).
const COLONNES = `
  f.id, f.code, f.nom, f.contact, f.telephone, f.email, f.adresse, f.ville, f.pays, f.nif,
  f.conditions_paiement, f.delai_livraison_jours, f.actif, f.type_fournisseur,
  f.point_source_id, f.point_id, f.principal, f.created_at, f.updated_at,
  po.nom AS point_nom
`;

const JOINTURE = `
  FROM pharmacie_fournisseurs f
  LEFT JOIN pharmacie_points po ON po.id = f.point_id
`;

/** Transforme une ligne SQL en objet JSON destine a l'API. */
export function serialiserFournisseur(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    nom: ligne.nom,
    contact: ligne.contact ?? null,
    telephone: ligne.telephone ?? null,
    email: ligne.email ?? null,
    adresse: ligne.adresse ?? null,
    ville: ligne.ville ?? null,
    pays: ligne.pays,
    nif: ligne.nif ?? null,
    conditionsPaiement: ligne.conditions_paiement ?? null,
    delaiLivraisonJours: ligne.delai_livraison_jours,
    actif: Boolean(ligne.actif),
    typeFournisseur: ligne.type_fournisseur ?? 'EXTERNE',
    pointSourceId: ligne.point_source_id ?? null,
    pointId: ligne.point_id ?? null,
    /** Nom de la pharmacie proprietaire du fournisseur (cloisonnement). */
    pointNom: ligne.point_nom ?? null,
    /** Fournisseur principal de la pharmacie (Pharmacie du Siege, INTERNE). */
    principal: Boolean(ligne.principal),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les fournisseurs (filtrable, cloisonnée par périmètre). */
export async function listerFournisseurs(filtres = {}, utilisateur = null) {
  const conditions = [];
  const parametres = [];

  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    const pointImpose = resoudrePointId(utilisateur, null);
    parametres.push(pointImpose);
    conditions.push(`f.point_id = $${parametres.length}`);
  } else if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`f.point_id = $${parametres.length}`);
  }

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(f.nom ILIKE $${i} OR f.code ILIKE $${i} OR f.contact ILIKE $${i})`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`f.actif = $${parametres.length}`);
  }
  if (filtres.typeFournisseur) {
    parametres.push(filtres.typeFournisseur);
    conditions.push(`f.type_fournisseur = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ${COLONNES} ${JOINTURE} ${clause} ORDER BY f.nom, f.code`,
    parametres
  );
  return rows.map(serialiserFournisseur);
}

/** Recupere un fournisseur ou null. */
export async function obtenirFournisseur(id) {
  const { rows } = await query(`SELECT ${COLONNES} ${JOINTURE} WHERE f.id = $1`, [id]);
  return rows[0] ? serialiserFournisseur(rows[0]) : null;
}

/** Recupere un fournisseur ou leve une 404. */
export async function exigerFournisseur(id) {
  const fournisseur = await obtenirFournisseur(id);
  if (!fournisseur) throw ApiError.notFound('Fournisseur introuvable.', 'FOURNISSEUR_INTROUVABLE');
  return fournisseur;
}

/**
 * Garantit qu'une succursale possede son fournisseur principal « Pharmacie du
 * Siège » (fournisseur INTERNE, source = magasin central ou pharmacie du siège).
 *
 * Idempotent : la ligne est creee si elle manque, sinon elle est remise a
 * niveau (nom, source, pharmacie proprietaire, marqueur principal). Les
 * fournisseurs propres a la succursale ne sont jamais modifies.
 *
 * @param {string} pointId Pharmacie cible.
 * @returns {Promise<object|null>} Fournisseur principal, ou null si le point
 *                                 n'est pas une succursale.
 */
export async function assurerFournisseurPrincipal(pointId) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.ville, p.type_point,
            source.id        AS source_id,
            source.telephone AS source_telephone
       FROM pharmacie_points p
       LEFT JOIN LATERAL (
         SELECT s.id, s.telephone
           FROM pharmacie_points s
          WHERE s.actif AND (s.code = 'MAG-PRINCIPE' OR s.type_point = 'SIEGE')
          ORDER BY CASE WHEN s.code = 'MAG-PRINCIPE' THEN 0 ELSE 1 END
          LIMIT 1
       ) source ON TRUE
      WHERE p.id = $1`,
    [pointId]
  );
  const point = rows[0];
  // Seules les succursales recoivent un fournisseur principal automatique.
  if (!point || point.type_point !== 'SUCCURSALE') return null;

  const code = `INT-${point.code}`;
  // Ne jamais detourner un code deja utilise par une autre pharmacie.
  const { rows: existantes } = await query(
    'SELECT id, point_id FROM pharmacie_fournisseurs WHERE code = $1',
    [code]
  );
  if (existantes[0] && existantes[0].point_id && existantes[0].point_id !== point.id) {
    return null;
  }

  // Le code de la pharmacie a pu changer : on renomme son fournisseur interne
  // existant (INT-<ancien code>) plutot que d'en creer un second.
  const { rows: actuels } = await query(
    `SELECT id, code, principal FROM pharmacie_fournisseurs
      WHERE point_id = $1 AND type_fournisseur = 'INTERNE'
      ORDER BY principal DESC, created_at
      LIMIT 1`,
    [point.id]
  );
  const renommable =
    actuels[0] &&
    actuels[0].code !== code &&
    !existantes[0] &&
    (actuels[0].principal || actuels[0].code.startsWith('INT-'));
  if (renommable) {
    await query('UPDATE pharmacie_fournisseurs SET code = $2 WHERE id = $1', [actuels[0].id, code]);
  }

  // Un seul fournisseur principal par pharmacie.
  await query(
    'UPDATE pharmacie_fournisseurs SET principal = FALSE WHERE point_id = $1 AND principal AND code <> $2',
    [point.id, code]
  );

  const { rows: enregistrees } = await query(
    `INSERT INTO pharmacie_fournisseurs
       (code, nom, contact, telephone, ville, conditions_paiement, delai_livraison_jours,
        type_fournisseur, point_source_id, point_id, principal, actif)
     VALUES ($1, 'Pharmacie du Siège', 'Direction Pharmacie', $2, $3, 'Interne', 0,
             'INTERNE', $4, $5, TRUE, TRUE)
     ON CONFLICT (code) DO UPDATE
       SET nom              = EXCLUDED.nom,
           type_fournisseur = 'INTERNE',
           point_source_id  = EXCLUDED.point_source_id,
           point_id         = EXCLUDED.point_id,
           principal        = TRUE,
           actif            = TRUE
     RETURNING id`,
    [code, point.source_telephone ?? null, point.ville ?? null, point.source_id ?? null, point.id]
  );
  return obtenirFournisseur(enregistrees[0].id);
}

/** Genere le prochain code fournisseur disponible (FOUR-0001, FOUR-0002...). */
async function genererCodeFournisseur() {
  const { rows } = await query(
    `SELECT COALESCE(MAX((substring(code from '[0-9]+$'))::int), 0) AS maximum
     FROM pharmacie_fournisseurs
     WHERE code ~ $1`,
    [`^${PREFIXE_CODE}[0-9]+$`]
  );
  const suivant = (rows[0]?.maximum ?? 0) + 1;
  return `${PREFIXE_CODE}${String(suivant).padStart(LONGUEUR_CODE, '0')}`;
}

/**
 * Cree un fournisseur. Le code est genere automatiquement (FOUR-0001...) quand
 * il n'est pas fourni : le formulaire ne le saisit plus.
 */
export async function creerFournisseur(donnees) {
  const codeImpose = donnees.code ? donnees.code.trim().toUpperCase() : null;

  // Quelques tentatives en cas de collision de code (creations simultanees).
  for (let tentative = 0; tentative < 5; tentative += 1) {
    const code = codeImpose ?? (await genererCodeFournisseur());
    try {
      const { rows } = await query(
        `INSERT INTO pharmacie_fournisseurs
           (code, nom, contact, telephone, email, adresse, ville, pays, nif,
            conditions_paiement, delai_livraison_jours, actif, type_fournisseur, point_source_id, point_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          code,
          donnees.nom.trim(),
          donnees.contact ?? null,
          donnees.telephone ?? null,
          donnees.email ?? null,
          donnees.adresse ?? null,
          donnees.ville ?? null,
          donnees.pays ?? 'Togo',
          donnees.nif ?? null,
          donnees.conditionsPaiement ?? null,
          donnees.delaiLivraisonJours ?? null,
          donnees.actif ?? true,
          donnees.typeFournisseur ?? 'EXTERNE',
          donnees.pointSourceId ?? null,
          donnees.pointId ?? null,
        ]
      );
      return obtenirFournisseur(rows[0].id);
    } catch (erreur) {
      // Code deja pris : on retente avec le suivant (uniquement s'il est genere).
      if (erreur.code === '23505' && !codeImpose) continue;
      throw erreur;
    }
  }

  throw ApiError.conflict(
    'Impossible de générer un code fournisseur disponible.',
    'CODE_FOURNISSEUR_INDISPONIBLE'
  );
}

/** Modifie partiellement un fournisseur. */
export async function modifierFournisseur(id, donnees) {
  const existant = await exigerFournisseur(id);

  // Le fournisseur principal (Pharmacie du Siege) est gere automatiquement :
  // il ne peut ni etre desactive ni change de nature.
  if (existant.principal && donnees.actif === false) {
    throw ApiError.conflict(
      'Le fournisseur principal (Pharmacie du Siège) ne peut pas être désactivé.',
      'FOURNISSEUR_PRINCIPAL_PROTEGE'
    );
  }
  if (existant.principal && donnees.typeFournisseur && donnees.typeFournisseur !== 'INTERNE') {
    throw ApiError.conflict(
      'Le fournisseur principal (Pharmacie du Siège) doit rester un fournisseur interne.',
      'FOURNISSEUR_PRINCIPAL_PROTEGE'
    );
  }

  const correspondances = {
    code: 'code',
    nom: 'nom',
    contact: 'contact',
    telephone: 'telephone',
    email: 'email',
    adresse: 'adresse',
    ville: 'ville',
    pays: 'pays',
    nif: 'nif',
    conditionsPaiement: 'conditions_paiement',
    delaiLivraisonJours: 'delai_livraison_jours',
    actif: 'actif',
    typeFournisseur: 'type_fournisseur',
    pointSourceId: 'point_source_id',
  };

  const champs = [];
  const valeurs = [];
  for (const [cle, colonne] of Object.entries(correspondances)) {
    if (donnees[cle] === undefined) continue;
    let valeur = donnees[cle];
    if (cle === 'code') valeur = valeur.trim().toUpperCase();
    if (cle === 'nom') valeur = valeur.trim();
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  }

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE pharmacie_fournisseurs SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }
  return obtenirFournisseur(id);
}

/** Desactive un fournisseur (archivage logique). */
export async function desactiverFournisseur(id) {
  const fournisseur = await exigerFournisseur(id);
  if (fournisseur.principal) {
    throw ApiError.conflict(
      'Le fournisseur principal (Pharmacie du Siège) ne peut pas être désactivé.',
      'FOURNISSEUR_PRINCIPAL_PROTEGE'
    );
  }
  await query('UPDATE pharmacie_fournisseurs SET actif = FALSE WHERE id = $1', [id]);
  return { id, code: fournisseur.code, nom: fournisseur.nom, actif: false };
}