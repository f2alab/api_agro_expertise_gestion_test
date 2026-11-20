// Service des inventaires de la pharmacie.
// Une session fige le stock theorique du point a son ouverture. La saisie des
// quantites physiques calcule les ecarts, et la validation ecrit les ajustements.

import { randomUUID } from 'node:crypto';
import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';

/** Genere un numero d'inventaire unique. */
function genererNumero() {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  return `INV-${jour}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

/** Transforme une ligne d'inventaire en objet API. */
function serialiserInventaire(ligne) {
  return {
    id: ligne.id,
    numero: ligne.numero,
    pointId: ligne.point_id,
    pointNom: ligne.point_nom,
    libelle: ligne.libelle ?? null,
    statut: ligne.statut,
    dateDebut: ligne.date_debut,
    dateFin: ligne.date_fin ?? null,
    commentaire: ligne.commentaire ?? null,
    nbLignes: ligne.nb_lignes ?? 0,
    nbEcarts: ligne.nb_ecarts ?? 0,
  };
}

/** Liste paginee des inventaires. */
export async function listerInventaires(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`i.point_id = $${parametres.length}`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`i.statut = $${parametres.length}`);
  }
  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM pharmacie_inventaires i ${clause}`, parametres),
    query(
      `SELECT i.*, po.nom AS point_nom,
              (SELECT count(*)::int FROM pharmacie_inventaires_lignes l WHERE l.inventaire_id = i.id) AS nb_lignes,
              (SELECT count(*)::int FROM pharmacie_inventaires_lignes l
                 WHERE l.inventaire_id = i.id AND l.ecart IS NOT NULL AND l.ecart <> 0) AS nb_ecarts
       FROM pharmacie_inventaires i
       JOIN pharmacie_points po ON po.id = i.point_id
       ${clause}
       ORDER BY i.date_debut DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserInventaire), compteur.rows[0].total, { page, limite });
}

/** Recupere un inventaire complet (avec lignes) ou null. */
export async function obtenirInventaire(id) {
  const { rows } = await query(
    `SELECT i.*, po.nom AS point_nom
     FROM pharmacie_inventaires i
     JOIN pharmacie_points po ON po.id = i.point_id
     WHERE i.id = $1`,
    [id]
  );
  if (!rows[0]) return null;

  const lignes = await query(
    `SELECT l.*, pr.code AS produit_code, pr.nom_commercial AS produit_nom
     FROM pharmacie_inventaires_lignes l
     JOIN pharmacie_produits pr ON pr.id = l.produit_id
     WHERE l.inventaire_id = $1
     ORDER BY pr.nom_commercial`,
    [id]
  );

  const inventaire = serialiserInventaire(rows[0]);
  inventaire.lignes = lignes.rows.map((ligne) => ({
    id: ligne.id,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    produitNom: ligne.produit_nom,
    lotId: ligne.lot_id,
    quantiteTheorique: ligne.quantite_theorique,
    quantitePhysique: ligne.quantite_physique,
    ecart: ligne.ecart,
    prixUnitaire: Number(ligne.prix_unitaire),
    valeurEcart: ligne.ecart === null ? null : ligne.ecart * Number(ligne.prix_unitaire),
  }));
  return inventaire;
}

/** Recupere un inventaire ou leve une 404. */
export async function exigerInventaire(id) {
  const inventaire = await obtenirInventaire(id);
  if (!inventaire) throw ApiError.notFound('Inventaire introuvable.', 'INVENTAIRE_INTROUVABLE');
  return inventaire;
}

/** Ouvre un inventaire : fige le stock theorique de tous les produits du point. */
export async function creerInventaire(donnees, acteur = null) {
  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO pharmacie_inventaires (numero, point_id, libelle, commentaire, cree_par)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [genererNumero(), donnees.pointId, donnees.libelle ?? null, donnees.commentaire ?? null, acteur?.id ?? null]
    );
    const inventaireId = rows[0].id;

    await client.query(
      `INSERT INTO pharmacie_inventaires_lignes
         (inventaire_id, produit_id, quantite_theorique, prix_unitaire)
       SELECT $1, v.produit_id, v.quantite, v.prix_achat
       FROM v_pharmacie_stock_valorise v
       WHERE v.point_id = $2`,
      [inventaireId, donnees.pointId]
    );

    return inventaireId;
  });

  return obtenirInventaire(id);
}

/** Saisit les quantites physiques comptees et calcule les ecarts. */
export async function enregistrerComptage(id, lignes) {
  const inventaire = await exigerInventaire(id);
  if (!['OUVERT', 'CLOTURE'].includes(inventaire.statut)) {
    throw ApiError.conflict("Cet inventaire n'accepte plus de comptage.", 'INVENTAIRE_NON_MODIFIABLE');
  }

  await transaction(async (client) => {
    for (const ligne of lignes) {
      await client.query(
        `UPDATE pharmacie_inventaires_lignes
         SET quantite_physique = $1, ecart = $1 - quantite_theorique
         WHERE id = $2 AND inventaire_id = $3`,
        [ligne.quantitePhysique, ligne.ligneId, id]
      );
    }
  });

  return obtenirInventaire(id);
}

/** Valide l'inventaire : ecrit un ajustement de stock pour chaque ecart. */
export async function validerInventaire(id, acteur = null) {
  const inventaire = await exigerInventaire(id);
  if (inventaire.statut === 'VALIDE') {
    throw ApiError.conflict('Cet inventaire est deja valide.', 'INVENTAIRE_DEJA_VALIDE');
  }

  await transaction(async (client) => {
    for (const ligne of inventaire.lignes) {
      if (ligne.ecart === null || ligne.ecart === 0) continue;

      // L'ajustement porte un delta signe : negatif = manquant, positif = excedent
      await client.query(
        `INSERT INTO pharmacie_mouvements_stock
           (point_id, produit_id, lot_id, type_mouvement, quantite, prix_unitaire, motif,
            reference_type, reference_id, utilisateur_id)
         VALUES ($1,$2,$3,'AJUSTEMENT',$4,$5,$6,'INVENTAIRE',$7,$8)`,
        [
          inventaire.pointId,
          ligne.produitId,
          ligne.lotId ?? null,
          ligne.ecart,
          ligne.prixUnitaire,
          `Ecart inventaire ${inventaire.numero}`,
          id,
          acteur?.id ?? null,
        ]
      );
    }

    await client.query(
      `UPDATE pharmacie_inventaires SET statut = 'VALIDE', date_fin = now(), valide_par = $1 WHERE id = $2`,
      [acteur?.id ?? null, id]
    );
  });

  return obtenirInventaire(id);
}