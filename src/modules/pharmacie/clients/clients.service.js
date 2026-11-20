// Service des clients de la pharmacie.
// Chaque client appartient a UNE pharmacie (point_id) : un compte non global
// ne voit et ne gere que les clients de sa pharmacie.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { perimetreUtilisateur, resoudrePointId } from '../../../utils/perimetre.js';

// Champs du client + statistiques d'achat calculees a la lecture.
const SELECT_CLIENT = `
  SELECT c.id, c.nom, c.telephone, c.email, c.adresse, c.actif, c.point_id,
         po.nom AS point_nom, c.created_at, c.updated_at,
         (SELECT count(*)::int FROM pharmacie_ventes v
           WHERE v.client_id = c.id AND v.statut = 'VALIDEE') AS nb_achats,
         (SELECT COALESCE(SUM(v.total_ttc), 0) FROM pharmacie_ventes v
           WHERE v.client_id = c.id AND v.statut = 'VALIDEE') AS chiffre_affaires,
         (SELECT COALESCE(SUM(v.reste_a_payer), 0) FROM pharmacie_ventes v
           WHERE v.client_id = c.id AND v.statut = 'VALIDEE' AND v.reste_a_payer > 0) AS montant_du,
         (SELECT count(*)::int FROM pharmacie_ventes v
           WHERE v.client_id = c.id AND v.statut = 'VALIDEE' AND v.reste_a_payer > 0) AS nb_ventes_credit
  FROM pharmacie_clients c
  LEFT JOIN pharmacie_points po ON po.id = c.point_id
`;

/** Transforme une ligne SQL en objet JSON destine a l'API. */
export function serialiserClient(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    nom: ligne.nom,
    telephone: ligne.telephone ?? null,
    email: ligne.email ?? null,
    adresse: ligne.adresse ?? null,
    actif: Boolean(ligne.actif),
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    nbAchats: ligne.nb_achats ?? 0,
    chiffreAffaires: Number(ligne.chiffre_affaires ?? 0),
    // Creance en cours : montant restant du par le client sur ses ventes a credit.
    montantDu: Number(ligne.montant_du ?? 0),
    nbVentesCredit: ligne.nb_ventes_credit ?? 0,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les clients (filtrée par le périmètre de l'utilisateur). */
export async function listerClients(filtres = {}, utilisateur = null) {
  const conditions = [];
  const parametres = [];

  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    const pointImpose = resoudrePointId(utilisateur, null);
    parametres.push(pointImpose);
    conditions.push(`c.point_id = $${parametres.length}`);
  } else if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`c.point_id = $${parametres.length}`);
  }

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(c.nom ILIKE $${i} OR c.telephone ILIKE $${i} OR c.email ILIKE $${i})`);
  }
  if (filtres.actif !== undefined) {
    parametres.push(filtres.actif === 'true');
    conditions.push(`c.actif = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Tri demandé par l'ecran (nom par defaut) : les alias d'agregation
  // (montant_du, chiffre_affaires, nb_achats) sont utilisables dans ORDER BY.
  const ordre = filtres.ordre ?? 'nom';
  const tris = {
    nom: 'c.nom ASC',
    pharmacie: 'po.nom ASC NULLS LAST, c.nom ASC',
    montant: 'montant_du DESC, c.nom ASC',
    ca: 'chiffre_affaires DESC, c.nom ASC',
    achats: 'nb_achats DESC, c.nom ASC',
    recent: 'c.created_at DESC, c.nom ASC',
  };
  const tri = tris[ordre] ?? tris.nom;

  const { rows } = await query(`${SELECT_CLIENT} ${clause} ORDER BY ${tri} LIMIT 500`, parametres);
  return rows.map(serialiserClient);
}

/** Recupere un client ou null. */
export async function obtenirClient(id) {
  const { rows } = await query(`${SELECT_CLIENT} WHERE c.id = $1`, [id]);
  return rows[0] ? serialiserClient(rows[0]) : null;
}

/** Recupere un client ou leve une 404. */
export async function exigerClient(id) {
  const client = await obtenirClient(id);
  if (!client) throw ApiError.notFound('Client introuvable.', 'CLIENT_INTROUVABLE');
  return client;
}

/** Cree un client rattache a une pharmacie (donnees.pointId). */
export async function creerClient(donnees) {
  const { rows } = await query(
    `INSERT INTO pharmacie_clients (nom, telephone, email, adresse, actif, point_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [
      donnees.nom.trim(),
      donnees.telephone ?? null,
      donnees.email ?? null,
      donnees.adresse ?? null,
      donnees.actif ?? true,
      donnees.pointId ?? null,
    ]
  );
  return obtenirClient(rows[0].id);
}

/** Modifie partiellement un client. */
export async function modifierClient(id, donnees) {
  await exigerClient(id);

  const champs = [];
  const valeurs = [];
  const ajouter = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.nom !== undefined) ajouter('nom', donnees.nom.trim());
  if (donnees.telephone !== undefined) ajouter('telephone', donnees.telephone || null);
  if (donnees.email !== undefined) ajouter('email', donnees.email || null);
  if (donnees.adresse !== undefined) ajouter('adresse', donnees.adresse || null);
  if (donnees.actif !== undefined) ajouter('actif', donnees.actif);

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE pharmacie_clients SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }
  return obtenirClient(id);
}

/** Supprime (desactive) un client - l'historique des ventes est conserve. */
export async function supprimerClient(id) {
  const client = await exigerClient(id);
  await query('UPDATE pharmacie_clients SET actif = FALSE WHERE id = $1', [id]);
  return { id, nom: client.nom, actif: false };
}

/**
 * Clients debiteurs : ceux qui ont au moins une vente a credit non soldee.
 * Cloisonne par perimetre (une pharmacie ne voit que ses propres creances).
 * Tri : montant du (defaut), anciennete de la derniere vente a credit, ou nom.
 */
export async function listerDebiteurs(filtres = {}, utilisateur = null) {
  const conditions = ["v.statut = 'VALIDEE'", 'v.reste_a_payer > 0', 'v.client_id IS NOT NULL'];
  const parametres = [];

  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    const pointImpose = resoudrePointId(utilisateur, null);
    parametres.push(pointImpose);
    conditions.push(`v.point_id = $${parametres.length}`);
  } else if (filtres.pointId) {
    parametres.push(filtres.pointId);
    conditions.push(`v.point_id = $${parametres.length}`);
  }

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(`(c.nom ILIKE $${i} OR c.telephone ILIKE $${i})`);
  }

  const ordre = filtres.ordre ?? 'montant';
  const tri =
    ordre === 'recent'
      ? 'derniere_vente DESC'
      : ordre === 'nom'
        ? 'c.nom ASC'
        : 'montant_du DESC';

  const { rows } = await query(
    `SELECT c.id, c.nom, c.telephone, c.email, c.point_id,
            po.nom AS point_nom,
            SUM(v.reste_a_payer) AS montant_du,
            SUM(v.total_ttc)     AS montant_credit,
            count(v.id)::int     AS nb_ventes,
            MAX(v.date_vente)    AS derniere_vente,
            MIN(v.date_vente)    AS premiere_vente
     FROM pharmacie_clients c
     JOIN pharmacie_ventes v ON v.client_id = c.id
     LEFT JOIN pharmacie_points po ON po.id = v.point_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY c.id, po.nom
     ORDER BY ${tri}
     LIMIT 500`,
    parametres
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    nom: ligne.nom,
    telephone: ligne.telephone ?? null,
    email: ligne.email ?? null,
    pointId: ligne.point_id ?? null,
    pointNom: ligne.point_nom ?? null,
    montantDu: Number(ligne.montant_du ?? 0),
    montantCredit: Number(ligne.montant_credit ?? 0),
    nbVentes: ligne.nb_ventes ?? 0,
    derniereVente: ligne.derniere_vente ?? null,
    premiereVente: ligne.premiere_vente ?? null,
  }));
}

/** Ventes a credit non soldees d'un client (detail de la creance). */
export async function listerCreancesClient(clientId, utilisateur = null) {
  await exigerClient(clientId);

  const parametres = [clientId];
  const conditions = ["v.client_id = $1", "v.statut = 'VALIDEE'", 'v.reste_a_payer > 0'];

  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    const pointImpose = resoudrePointId(utilisateur, null);
    parametres.push(pointImpose);
    conditions.push(`v.point_id = $${parametres.length}`);
  }

  const { rows } = await query(
    `SELECT v.id, v.numero, v.date_vente, v.total_ttc, v.total_paye, v.reste_a_payer, po.nom AS point_nom
     FROM pharmacie_ventes v
     JOIN pharmacie_points po ON po.id = v.point_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY v.date_vente DESC`,
    parametres
  );

  return rows.map((ligne) => ({
    venteId: ligne.id,
    numero: ligne.numero,
    dateVente: ligne.date_vente,
    totalTTC: Number(ligne.total_ttc),
    totalPaye: Number(ligne.total_paye ?? 0),
    resteAPayer: Number(ligne.reste_a_payer ?? 0),
    pointNom: ligne.point_nom ?? null,
  }));
}

/** Meilleurs clients par chiffre d'affaires (top N, filtré par périmètre). */
export async function listerTopClients(limite = 10, utilisateur = null) {
  const parametres = [limite];
  const conditions = ["v.statut = 'VALIDEE'"];

  const perimetre = perimetreUtilisateur(utilisateur);
  if (!perimetre.global) {
    const pointImpose = resoudrePointId(utilisateur, null);
    parametres.push(pointImpose);
    conditions.push(`c.point_id = $${parametres.length}`);
  }

  const { rows } = await query(
    `SELECT c.id, c.nom, c.telephone, c.email,
            count(v.id)::int AS nb_achats,
            COALESCE(SUM(v.total_ttc), 0) AS chiffre_affaires,
            MAX(v.date_vente) AS derniere_vente
     FROM pharmacie_clients c
     JOIN pharmacie_ventes v ON v.client_id = c.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY c.id
     ORDER BY chiffre_affaires DESC, nb_achats DESC
     LIMIT $1`,
    parametres
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    nom: ligne.nom,
    telephone: ligne.telephone ?? null,
    email: ligne.email ?? null,
    nbAchats: ligne.nb_achats,
    chiffreAffaires: Number(ligne.chiffre_affaires ?? 0),
    derniereVente: ligne.derniere_vente ?? null,
  }));
}