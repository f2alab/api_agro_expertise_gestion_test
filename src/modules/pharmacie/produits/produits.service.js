// Service des produits de la pharmacie.
// Couvre le referentiel central (fiche maitre) et le parametrage local par point
// de vente (prix, seuil, disponibilite) ainsi que le catalogue exploitable.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';
import { verifierCodeReferentiel } from '../referentiels/referentiels.service.js';

const COLONNES_PRODUIT = `
  pr.id, pr.code, pr.code_barres, pr.dci, pr.nom_commercial, pr.forme_galenique,
  pr.dosage, pr.presentation, pr.forme, pr.categorie, pr.unite_mesure, pr.rayon, pr.necessite_ordonnance,
  pr.gere_lot, pr.gere_peremption,
  pr.tva_taux, pr.laboratoire, pr.description, pr.actif, pr.created_at, pr.updated_at
`;

/** Transforme une ligne SQL en objet JSON destine a l'API. */
export function serialiserProduit(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    codeBarres: ligne.code_barres ?? null,
    dci: ligne.dci ?? null,
    nomCommercial: ligne.nom_commercial,
    formeGalenique: ligne.forme_galenique ?? null,
    dosage: ligne.dosage ?? null,
    presentation: ligne.presentation ?? null,
    forme: ligne.forme ?? null,
    categorie: ligne.categorie ?? null,
    uniteMesure: ligne.unite_mesure ?? null,
    rayon: ligne.rayon ?? null,
    necessiteOrdonnance: Boolean(ligne.necessite_ordonnance),
    gereLot: Boolean(ligne.gere_lot),
    gerePeremption: Boolean(ligne.gere_peremption),
    tvaTaux: Number(ligne.tva_taux ?? 0),
    laboratoire: ligne.laboratoire ?? null,
    description: ligne.description ?? null,
    actif: Boolean(ligne.actif),
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Normalise un code de referentiel facultatif : vide -> null, sinon MAJUSCULES. */
function normaliserCodeReferentiel(valeur) {
  if (valeur === undefined || valeur === null) return null;
  const texte = String(valeur).trim();
  return texte === '' ? null : texte.toUpperCase();
}

/** Liste paginee du referentiel produits. */
export async function listerProduits(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(pr.nom_commercial ILIKE $${i} OR pr.code ILIKE $${i} OR pr.dci ILIKE $${i} OR pr.code_barres ILIKE $${i})`
    );
  }
  if (filtres.categorie) {
    parametres.push(filtres.categorie);
    conditions.push(`pr.categorie = $${parametres.length}`);
  }
  if (filtres.rayon) {
    parametres.push(filtres.rayon);
    conditions.push(`pr.rayon = $${parametres.length}`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`pr.actif = $${parametres.length}`);
  }
  // Liste propre à une pharmacie : uniquement les produits qu'elle référence.
  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(
      `EXISTS (SELECT 1 FROM pharmacie_produits_points ppx
               WHERE ppx.produit_id = pr.id AND ppx.point_id = $${parametres.length})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM pharmacie_produits pr ${clause}`, parametres),
    query(
      `SELECT ${COLONNES_PRODUIT} FROM pharmacie_produits pr ${clause}
       ORDER BY pr.nom_commercial
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserProduit), compteur.rows[0].total, { page, limite });
}

/** Recupere un produit ou null. */
export async function obtenirProduit(id) {
  const { rows } = await query(`SELECT ${COLONNES_PRODUIT} FROM pharmacie_produits pr WHERE pr.id = $1`, [id]);
  return rows[0] ? serialiserProduit(rows[0]) : null;
}

/** Recupere un produit ou leve une 404. */
export async function exigerProduit(id) {
  const produit = await obtenirProduit(id);
  if (!produit) throw ApiError.notFound('Produit introuvable.', 'PRODUIT_INTROUVABLE');
  return produit;
}

/** Cree un produit dans le referentiel central et l'ajoute a la liste du point. */
export async function creerProduit(donnees, acteur = null) {
  // Codes de referentiels (familles / unites de comptage / rayons / formes) :
  // facultatifs. Un code fourni doit exister et etre actif.
  const categorie = normaliserCodeReferentiel(donnees.categorie);
  const uniteMesure = normaliserCodeReferentiel(donnees.uniteMesure);
  const rayon = normaliserCodeReferentiel(donnees.rayon);
  const forme = normaliserCodeReferentiel(donnees.forme);
  await verifierCodeReferentiel('CATEGORIE', categorie, 'Famille');
  await verifierCodeReferentiel('UNITE', uniteMesure, 'Unite de comptage');
  await verifierCodeReferentiel('RAYON', rayon, 'Rayon');
  await verifierCodeReferentiel('FORME', forme, 'Forme');

  // Le suivi de la peremption repose sur les lots : un produit dont la date de
  // peremption est suivie est donc forcement gere par lot.
  if (donnees.gerePeremption) donnees.gereLot = true;

  const { rows } = await query(
    `INSERT INTO pharmacie_produits
       (code, code_barres, dci, nom_commercial, forme_galenique, dosage, presentation, forme,
        categorie, unite_mesure, rayon, necessite_ordonnance, gere_lot, gere_peremption,
        tva_taux, laboratoire, description, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      donnees.code.trim().toUpperCase(),
      donnees.codeBarres ?? null,
      donnees.dci ?? null,
      donnees.nomCommercial.trim(),
      donnees.formeGalenique ?? null,
      donnees.dosage ?? null,
      donnees.presentation ?? null,
      forme,
      categorie,
      uniteMesure,
      rayon,
      donnees.necessiteOrdonnance ?? false,
      donnees.gereLot ?? false,
      donnees.gerePeremption ?? false,
      donnees.tvaTaux ?? 0,
      donnees.laboratoire ?? null,
      donnees.description ?? null,
      acteur?.id ?? null,
    ]
  );
  const produitId = rows[0].id;

  // Rattachement a la liste locale : une pharmacie (ex. succursale / PPV)
  // retrouve immediatement le produit dans SON catalogue, avec ses prix.
  if (donnees.pointId) {
    await query(
      `INSERT INTO pharmacie_produits_points
         (produit_id, point_id, prix_vente, prix_achat_reference, seuil_alerte, disponible)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (produit_id, point_id) DO NOTHING`,
      [
        produitId,
        donnees.pointId,
        donnees.prixVente ?? 0,
        donnees.prixAchatReference ?? 0,
        donnees.seuilAlerte ?? 0,
      ]
    );
  }

  return obtenirProduit(produitId);
}

/** Modifie partiellement un produit. */
export async function modifierProduit(id, donnees) {
  await exigerProduit(id);

  // Verifie les codes de referentiels modifies (categories / unites / rayons).
  if (donnees.categorie !== undefined) await verifierCodeReferentiel('CATEGORIE', donnees.categorie, 'Famille');
  if (donnees.uniteMesure !== undefined) await verifierCodeReferentiel('UNITE', donnees.uniteMesure, 'Unite de comptage');
  if (donnees.rayon !== undefined) await verifierCodeReferentiel('RAYON', donnees.rayon, 'Rayon');
  if (donnees.forme !== undefined) await verifierCodeReferentiel('FORME', donnees.forme, 'Forme');

  // Un produit suivi en peremption est forcement gere par lot.
  if (donnees.gerePeremption === true) donnees.gereLot = true;

  const correspondances = {
    code: 'code',
    codeBarres: 'code_barres',
    dci: 'dci',
    nomCommercial: 'nom_commercial',
    formeGalenique: 'forme_galenique',
    dosage: 'dosage',
    presentation: 'presentation',
    forme: 'forme',
    categorie: 'categorie',
    uniteMesure: 'unite_mesure',
    rayon: 'rayon',
    necessiteOrdonnance: 'necessite_ordonnance',
    gereLot: 'gere_lot',
    gerePeremption: 'gere_peremption',
    tvaTaux: 'tva_taux',
    laboratoire: 'laboratoire',
    description: 'description',
    actif: 'actif',
  };

  const champs = [];
  const valeurs = [];
  for (const [cle, colonne] of Object.entries(correspondances)) {
    if (donnees[cle] === undefined) continue;
    let valeur = donnees[cle];
    if (cle === 'code') {
      valeur = String(valeur).trim().toUpperCase();
    } else if (cle === 'nomCommercial') {
      valeur = valeur.trim();
    } else if (cle === 'categorie' || cle === 'uniteMesure' || cle === 'rayon' || cle === 'forme') {
      // Codes de referentiels facultatifs : vide -> null, sinon MAJUSCULES.
      valeur = valeur ? String(valeur).trim().toUpperCase() : null;
    }
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  }

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE pharmacie_produits SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }
  return obtenirProduit(id);
}

// -----------------------------------------------------------------------------
// Parametrage local (produit x point de vente)
// -----------------------------------------------------------------------------

/** Transforme une ligne de parametrage en objet API. */
function serialiserParametrage(ligne) {
  return {
    id: ligne.id,
    pointId: ligne.point_id,
    pointCode: ligne.point_code,
    pointNom: ligne.point_nom,
    prixVente: Number(ligne.prix_vente),
    prixAchatReference: Number(ligne.prix_achat_reference),
    seuilAlerte: ligne.seuil_alerte,
    quantiteMax: ligne.quantite_max,
    referenceLocale: ligne.reference_locale ?? null,
    disponible: Boolean(ligne.disponible),
  };
}

/** Liste le parametrage d'un produit (tous les points, ou un seul si pointId). */
export async function listerParametrageProduit(produitId, pointId = null) {
  await exigerProduit(produitId);
  const parametres = [produitId];
  let clausePoint = '';
  if (pointId) {
    parametres.push(pointId);
    clausePoint = ` AND pp.point_id = $${parametres.length}`;
  }
  const { rows } = await query(
    `SELECT pp.id, pp.point_id, po.code AS point_code, po.nom AS point_nom,
            pp.prix_vente, pp.prix_achat_reference, pp.seuil_alerte, pp.quantite_max,
            pp.reference_locale, pp.disponible
     FROM pharmacie_produits_points pp
     JOIN pharmacie_points po ON po.id = pp.point_id
     WHERE pp.produit_id = $1${clausePoint}
     ORDER BY po.nom`,
    parametres
  );
  return rows.map(serialiserParametrage);
}

/** Cree ou met a jour le parametrage d'un produit dans un point (upsert). */
export async function definirParametrageProduit(produitId, donnees) {
  await exigerProduit(produitId);

  const point = await query('SELECT 1 FROM pharmacie_points WHERE id = $1', [donnees.pointId]);
  if (point.rowCount === 0) throw ApiError.notFound('Point de vente introuvable.', 'POINT_INTROUVABLE');

  await query(
    `INSERT INTO pharmacie_produits_points
       (produit_id, point_id, prix_vente, prix_achat_reference, seuil_alerte, quantite_max, reference_locale, disponible)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (produit_id, point_id) DO UPDATE SET
       prix_vente = EXCLUDED.prix_vente,
       prix_achat_reference = EXCLUDED.prix_achat_reference,
       seuil_alerte = EXCLUDED.seuil_alerte,
       quantite_max = EXCLUDED.quantite_max,
       reference_locale = EXCLUDED.reference_locale,
       disponible = EXCLUDED.disponible`,
    [
      produitId,
      donnees.pointId,
      donnees.prixVente ?? 0,
      donnees.prixAchatReference ?? 0,
      donnees.seuilAlerte ?? 0,
      donnees.quantiteMax ?? null,
      donnees.referenceLocale ?? null,
      donnees.disponible ?? true,
    ]
  );

  return listerParametrageProduit(produitId, donnees.pointId ?? null);
}
