// Service des ordonnances de la clinique.
// Une ordonnance transmet à la pharmacie les produits prescrits ; elle porte un
// instantané (désignation, prix unitaire) pour rester lisible dans le temps.

import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { arrondi, genererNumero } from '../clinique.service.js';
import { exigerConsultation } from '../consultations/consultations.service.js';

// Ordonnance + animal + propriétaire + pharmacie destinataire.
const SELECT_ORDONNANCE = `
  SELECT o.id, o.numero, o.consultation_id, o.animal_id, o.proprietaire_id, o.point_id,
         o.instructions, o.statut, o.emis_par, o.delivre_le,
         o.approuve_par, o.approuve_le, o.created_at, o.updated_at,
         c.numero AS consultation_numero,
         a.code AS animal_code, a.nom AS animal_nom, a.espece,
         p.code AS proprietaire_code, p.nom AS proprietaire_nom,
         p.telephone AS proprietaire_telephone,
         po.nom AS point_nom,
         (u.nom || ' ' || u.prenom)  AS emis_par_nom,
         (ap.nom || ' ' || ap.prenom) AS approuve_par_nom
  FROM clinique_ordonnances o
  JOIN clinique_consultations c ON c.id = o.consultation_id
  JOIN clinique_animaux a        ON a.id = o.animal_id
  JOIN clinique_proprietaires p  ON p.id = o.proprietaire_id
  LEFT JOIN pharmacie_points po  ON po.id = o.point_id
  LEFT JOIN utilisateurs u       ON u.id = o.emis_par
  LEFT JOIN utilisateurs ap      ON ap.id = o.approuve_par
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserOrdonnance(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    numero: ligne.numero,
    consultationId: ligne.consultation_id,
    consultationNumero: ligne.consultation_numero ?? null,
    animalId: ligne.animal_id,
    animalCode: ligne.animal_code ?? null,
    animalNom: ligne.animal_nom ?? null,
    espece: ligne.espece ?? null,
    proprietaireId: ligne.proprietaire_id,
    proprietaireCode: ligne.proprietaire_code ?? null,
    proprietaireNom: ligne.proprietaire_nom ?? null,
    proprietaireTelephone: ligne.proprietaire_telephone ?? null,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    instructions: ligne.instructions ?? null,
    statut: ligne.statut,
    emisParNom: ligne.emis_par_nom ?? null,
    // Approbation par le Docteur vétérinaire (une proposition peut rester en attente).
    approuveParNom: ligne.approuve_par_nom ?? null,
    approuveLe: ligne.approuve_le ?? null,
    delivreLe: ligne.delivre_le ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Lignes de produits d'une ordonnance. */
export async function listerLignes(ordonnanceId) {
  const { rows } = await query(
    `SELECT l.id, l.produit_id, l.designation, l.dosage, l.posologie, l.voie,
            l.duree_jours, l.quantite, l.prix_unitaire, l.vendu, l.notes, l.ordre,
            pr.code AS produit_code
     FROM clinique_ordonnances_lignes l
     JOIN pharmacie_produits pr ON pr.id = l.produit_id
     WHERE l.ordonnance_id = $1
     ORDER BY l.ordre, l.created_at`,
    [ordonnanceId]
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    produitId: ligne.produit_id,
    produitCode: ligne.produit_code,
    designation: ligne.designation,
    dosage: ligne.dosage ?? null,
    posologie: ligne.posologie ?? null,
    voie: ligne.voie ?? null,
    dureeJours: ligne.duree_jours ?? null,
    quantite: Number(ligne.quantite ?? 0),
    prixUnitaire: Number(ligne.prix_unitaire ?? 0),
    montant: arrondi(Number(ligne.quantite ?? 0) * Number(ligne.prix_unitaire ?? 0)),
    vendu: Boolean(ligne.vendu),
    notes: ligne.notes ?? null,
  }));
}

/** Ordonnance complète (entête + lignes calculées). */
export async function obtenirOrdonnance(id) {
  const { rows } = await query(`${SELECT_ORDONNANCE} WHERE o.id = $1`, [id]);
  if (!rows[0]) return null;

  const ordonnance = serialiserOrdonnance(rows[0]);
  ordonnance.lignes = await listerLignes(id);
  ordonnance.montantTotal = arrondi(
    ordonnance.lignes.reduce((total, ligne) => total + ligne.montant, 0)
  );
  return ordonnance;
}

/** Ordonnance ou 404. */
export async function exigerOrdonnance(id) {
  const ordonnance = await obtenirOrdonnance(id);
  if (!ordonnance) {
    throw ApiError.notFound('Ordonnance introuvable.', 'ORDONNANCE_INTROUVABLE');
  }
  return ordonnance;
}

/** Liste des ordonnances (filtres statut, consultation, animal, période). */
export async function listerOrdonnances(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`o.statut = $${parametres.length}`);
  }
  if (filtres.consultationId) {
    parametres.push(filtres.consultationId);
    conditions.push(`o.consultation_id = $${parametres.length}`);
  }
  if (filtres.animalId) {
    parametres.push(filtres.animalId);
    conditions.push(`o.animal_id = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`o.created_at >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`o.created_at < ($${parametres.length}::date + interval '1 day')`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(o.numero ILIKE $${i} OR a.nom ILIKE $${i} OR p.nom ILIKE $${i} OR a.code ILIKE $${i})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_ORDONNANCE} ${clause} ORDER BY o.created_at DESC LIMIT 500`,
    parametres
  );

  const resultat = [];
  for (const ligne of rows) {
    const ordonnance = serialiserOrdonnance(ligne);
    const lignes = await listerLignes(ordonnance.id);
    ordonnance.nbLignes = lignes.length;
    ordonnance.montantTotal = arrondi(lignes.reduce((total, item) => total + item.montant, 0));
    resultat.push(ordonnance);
  }
  return resultat;
}

/** Ordonnances émises et non encore servies (file de la pharmacie). */
export async function listerAServir() {
  const { rows } = await query(
    'SELECT * FROM v_clinique_ordonnances_a_servir ORDER BY emise_le ASC'
  );
  return rows.map((ligne) => ({
    id: ligne.id,
    numero: ligne.numero,
    statut: ligne.statut,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    emiseLe: ligne.emise_le,
    approuveLe: ligne.approuve_le ?? null,
    emisParNom: ligne.emis_par_nom ?? null,
    approuveParNom: ligne.approuve_par_nom ?? null,
    animalCode: ligne.animal_code,
    animalNom: ligne.animal_nom,
    espece: ligne.espece,
    proprietaireNom: ligne.proprietaire_nom,
    proprietaireTelephone: ligne.proprietaire_telephone ?? null,
    nbLignes: ligne.nb_lignes ?? 0,
    montantEstime: Number(ligne.montant_estime ?? 0),
  }));
}

/**
 * Charge les produits prescrits avec leur prix de vente.
 * Le prix retenu est celui du point demandé ; à défaut, le premier tarif du
 * catalogue évite une ordonnance à 0 F.
 */
async function chargerProduits(produitIds, pointId, client = null) {
  const executer = client ? (texte, parametres) => client.query(texte, parametres) : query;
  const { rows } = await executer(
    `SELECT pr.id, pr.code, pr.nom_commercial, pr.dosage,
            COALESCE((
              SELECT pp.prix_vente FROM pharmacie_produits_points pp
              WHERE pp.produit_id = pr.id AND ($2::uuid IS NULL OR pp.point_id = $2)
              ORDER BY CASE WHEN pp.point_id = $2 THEN 0 ELSE 1 END
              LIMIT 1
            ), 0) AS prix_vente
     FROM pharmacie_produits pr
     WHERE pr.id = ANY($1::uuid[])`,
    [produitIds, pointId ?? null]
  );
  return new Map(rows.map((ligne) => [ligne.id, ligne]));
}

/** Désignation imprimée sur l'ordonnance (nom commercial + dosage). */
function designationProduit(produit) {
  return [produit.nom_commercial, produit.dosage].filter(Boolean).join(' ').trim();
}

/**
 * Vrai si l'utilisateur est habilité à engager une prescription (permission
 * `clinique.ordonnances.approve`, portée par le Docteur vétérinaire).
 * Le super administrateur contourne les contrôles comme partout ailleurs.
 */
function detientDroitApprobation(utilisateur) {
  if (!utilisateur) return false;
  if (utilisateur.superAdmin) return true;
  return (utilisateur.permissions ?? []).includes('clinique.ordonnances.approve');
}

/**
 * Crée une ordonnance et ses lignes. Deux situations :
 *
 *  - l'auteur détient `clinique.ordonnances.approve` (Docteur vétérinaire) :
 *    sa prescription engage la clinique, elle est créée directement approuvée
 *    (`EMISE`, `approuve_par` / `approuve_le` renseignés) et transmise à la
 *    pharmacie ;
 *  - sinon (Assistant vétérinaire, technicien, stagiaire...) : elle est
 *    enregistrée comme **proposition** (`BROUILLON`) et devra être approuvée -
 *    ou ajustée puis approuvée (`approuverOrdonnance`) - par le Docteur
 *    vétérinaire avant tout service en pharmacie.
 */
export async function creerOrdonnance(donnees, utilisateur = null) {
  const consultation = await exigerConsultation(donnees.consultationId);
  if (consultation.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette consultation est annulée.', 'CONSULTATION_ANNULEE');
  }

  const droitApprobation = detientDroitApprobation(utilisateur);
  const statut = droitApprobation ? 'EMISE' : 'BROUILLON';

  const pointId = donnees.pointId ?? null;
  const produits = await chargerProduits(
    [...new Set(donnees.lignes.map((ligne) => ligne.produitId))],
    pointId
  );
  for (const ligne of donnees.lignes) {
    if (!produits.has(ligne.produitId)) {
      throw ApiError.badRequest(
        'Produit introuvable dans le référentiel pharmacie.',
        'PRODUIT_INTROUVABLE',
        { produitId: ligne.produitId }
      );
    }
  }

  const numero = await genererNumero('ORD');

  const ordonnanceId = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO clinique_ordonnances
         (numero, consultation_id, animal_id, proprietaire_id, point_id, instructions, statut,
          emis_par, approuve_par, approuve_le)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        numero,
        consultation.id,
        consultation.animalId,
        consultation.proprietaireId,
        pointId,
        donnees.instructions ?? null,
        statut,
        utilisateur?.id ?? null,
        // Auto-approbation du Docteur vétérinaire : sa prescription est
        // directement opposable, l'acte est trace (auteur = approbateur).
        droitApprobation ? utilisateur?.id ?? null : null,
        droitApprobation ? new Date() : null,
      ]
    );
    const id = rows[0].id;

    let ordre = 0;
    for (const ligne of donnees.lignes) {
      const produit = produits.get(ligne.produitId);
      const prix = ligne.prixUnitaire ?? Number(produit.prix_vente ?? 0);
      await client.query(
        `INSERT INTO clinique_ordonnances_lignes
           (ordonnance_id, produit_id, designation, dosage, posologie, voie, duree_jours,
            quantite, prix_unitaire, notes, ordre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          ligne.produitId,
          designationProduit(produit),
          ligne.dosage ?? produit.dosage ?? null,
          ligne.posologie ?? null,
          ligne.voie ?? null,
          ligne.dureeJours ?? null,
          ligne.quantite,
          arrondi(prix),
          ligne.notes ?? null,
          ordre,
        ]
      );
      ordre += 1;
    }

    // Le parcours bascule à l'étape « ordonnance ».
    await client.query(
      `UPDATE clinique_consultations
       SET statut = CASE WHEN statut IN ('ACCUEIL','EN_ATTENTE_PAIEMENT','EN_CONSULTATION',
                                         'EXAMEN_PARACLINIQUE','RESULTATS')
                         THEN 'ORDONNANCE' ELSE statut END
       WHERE id = $1`,
      [consultation.id]
    );

    return id;
  });

  return obtenirOrdonnance(ordonnanceId);
}

/**
 * Modifie une **proposition** d'ordonnance (instructions, pharmacie, produits).
 * Le Docteur vétérinaire ajuste la prescription avant de l'approuver ; une
 * ordonnance déjà approuvée (transmise à la pharmacie) n'est plus modifiable.
 */
export async function modifierOrdonnance(id, donnees) {
  const ordonnance = await exigerOrdonnance(id);
  if (ordonnance.statut !== 'BROUILLON') {
    throw ApiError.conflict(
      'Seule une ordonnance proposée (en attente d approbation) peut être modifiée.',
      'ORDONNANCE_FIGEE',
      { statut: ordonnance.statut }
    );
  }

  const pointId = donnees.pointId !== undefined ? donnees.pointId : ordonnance.pointId;

  await transaction(async (client) => {
    const champs = [];
    const valeurs = [];
    const ajouter = (colonne, valeur) => {
      valeurs.push(valeur);
      champs.push(`${colonne} = $${valeurs.length}`);
    };
    if (donnees.pointId !== undefined) ajouter('point_id', donnees.pointId);
    if (donnees.instructions !== undefined) ajouter('instructions', donnees.instructions);

    if (champs.length > 0) {
      valeurs.push(id);
      await client.query(
        `UPDATE clinique_ordonnances SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
        valeurs
      );
    }

    if (donnees.lignes) {
      const produits = await chargerProduits(
        [...new Set(donnees.lignes.map((ligne) => ligne.produitId))],
        pointId,
        client
      );
      await client.query('DELETE FROM clinique_ordonnances_lignes WHERE ordonnance_id = $1', [id]);

      let ordre = 0;
      for (const ligne of donnees.lignes) {
        const produit = produits.get(ligne.produitId);
        if (!produit) {
          throw ApiError.badRequest(
            'Produit introuvable dans le référentiel pharmacie.',
            'PRODUIT_INTROUVABLE',
            { produitId: ligne.produitId }
          );
        }
        const prix = ligne.prixUnitaire ?? Number(produit.prix_vente ?? 0);
        await client.query(
          `INSERT INTO clinique_ordonnances_lignes
             (ordonnance_id, produit_id, designation, dosage, posologie, voie, duree_jours,
              quantite, prix_unitaire, notes, ordre)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            ligne.produitId,
            designationProduit(produit),
            ligne.dosage ?? produit.dosage ?? null,
            ligne.posologie ?? null,
            ligne.voie ?? null,
            ligne.dureeJours ?? null,
            ligne.quantite,
            arrondi(prix),
            ligne.notes ?? null,
            ordre,
          ]
        );
        ordre += 1;
      }
    }
  });

  return obtenirOrdonnance(id);
}

/**
 * Approuve (valide) une proposition d'ordonnance : c'est le **Docteur
 * vétérinaire** qui engage la prescription.
 *
 * Effet : `statut = 'EMISE'`, `approuve_par` / `approuve_le` renseignés.
 * L'ordonnance entre alors dans la file de la pharmacie (`a-servir`) et devient
 * facturable ; elle n'est plus modifiable (seule l'annulation reste possible
 * tant qu'elle n'est pas servie).
 *
 * Permission `clinique.ordonnances.approve`, detenue par les medecins
 * (Direction Technique, Responsable clinique) : un consultant ne peut pas
 * approuver sa propre proposition.
 */
export async function approuverOrdonnance(id, utilisateur = null) {
  const ordonnance = await exigerOrdonnance(id);

  if (ordonnance.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette ordonnance est annulée.', 'ORDONNANCE_ANNULEE');
  }
  if (ordonnance.statut === 'SERVIE') {
    throw ApiError.conflict(
      'Cette ordonnance a déjà été servie par la pharmacie.',
      'ORDONNANCE_SERVIE'
    );
  }
  if (ordonnance.statut === 'EMISE') {
    return ordonnance; // déjà approuvée : opération idempotente
  }
  if (ordonnance.lignes.length === 0) {
    throw ApiError.badRequest(
      'Impossible d approuver une ordonnance sans produit prescrit.',
      'ORDONNANCE_VIDE'
    );
  }

  await query(
    `UPDATE clinique_ordonnances
     SET statut = 'EMISE', approuve_par = $2, approuve_le = now()
     WHERE id = $1`,
    [id, utilisateur?.id ?? null]
  );

  return obtenirOrdonnance(id);
}

/**
 * Marque l'ordonnance comme servie par la pharmacie.
 * Si la vente correspondante est fournie, elle est rattachée à l'ordonnance et
 * à la consultation : la traçabilité remonte du ticket au diagnostic.
 */
export async function servirOrdonnance(id, donnees = {}) {
  const ordonnance = await exigerOrdonnance(id);
  if (ordonnance.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette ordonnance est annulée.', 'ORDONNANCE_ANNULEE');
  }
  // Une proposition non approuvée ne peut pas être délivrée : le Docteur
  // vétérinaire doit d'abord engager la prescription.
  if (['BROUILLON', 'EMISE'].includes(ordonnance.statut) && !ordonnance.approuveLe) {
    throw ApiError.conflict(
      'Cette ordonnance est encore une proposition : elle doit être approuvée par le Docteur vétérinaire.',
      'ORDONNANCE_NON_APPROUVEE'
    );
  }
  if (ordonnance.statut === 'SERVIE' && !donnees.venteId) return ordonnance;

  await query(
    `UPDATE clinique_ordonnances SET statut = 'SERVIE', delivre_le = COALESCE(delivre_le, now())
     WHERE id = $1`,
    [id]
  );

  if (donnees.venteId) {
    await query('UPDATE clinique_ordonnances_lignes SET vendu = TRUE WHERE ordonnance_id = $1', [id]);
    await query('UPDATE pharmacie_ventes SET ordonnance_id = $2, consultation_id = $3 WHERE id = $1', [
      donnees.venteId,
      id,
      ordonnance.consultationId,
    ]);
  }

  return obtenirOrdonnance(id);
}

/** Annule une ordonnance non servie (le motif est conservé dans les instructions). */
export async function annulerOrdonnance(id, motif) {
  const ordonnance = await exigerOrdonnance(id);
  if (ordonnance.statut === 'SERVIE') {
    throw ApiError.conflict(
      'Une ordonnance déjà servie ne peut pas être annulée.',
      'ORDONNANCE_SERVIE'
    );
  }
  await query(
    `UPDATE clinique_ordonnances
     SET statut = 'ANNULEE', instructions = COALESCE(instructions || E'\n', '') || $2
     WHERE id = $1`,
    [id, `[ANNULATION] ${motif}`]
  );
  return obtenirOrdonnance(id);
}