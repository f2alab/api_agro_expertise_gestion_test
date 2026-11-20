
// Service Tableau de bord : indicateurs consolidés du module IAM.

import { query } from '../../config/database.js';

/** Compteurs principaux + répartitions pour la page d'accueil. */
export async function statistiquesTableauDeBord() {
  const [compteurs, statuts, parModule, departements, activite] = await Promise.all([
    query(`
      SELECT
        (SELECT count(*)::int FROM utilisateurs)                                      AS utilisateurs_total,
        (SELECT count(*)::int FROM utilisateurs WHERE statut = 'ACTIF')               AS utilisateurs_actifs,
        (SELECT count(*)::int FROM utilisateurs
          WHERE derniere_connexion > now() - interval '24 hours')                     AS connexions_24h,
        (SELECT count(*)::int FROM roles WHERE actif = TRUE)                          AS roles_actifs,
        (SELECT count(*)::int FROM permissions)                                       AS permissions_total,
        (SELECT count(*)::int FROM departements WHERE actif = TRUE)                   AS departements_actifs,
        (SELECT count(*)::int FROM jetons_rafraichissement
          WHERE revoque_le IS NULL AND expire_le > now())                             AS sessions_actives,
        (SELECT count(*)::int FROM journal_audit
          WHERE statut = 'ECHEC' AND cree_le > now() - interval '24 hours')           AS echecs_24h
    `),
    query(`
      SELECT statut, count(*)::int AS total
      FROM utilisateurs
      GROUP BY statut
      ORDER BY statut
    `),
    query(`
      SELECT module, count(*)::int AS total
      FROM permissions
      GROUP BY module
      ORDER BY total DESC, module
    `),
    query(`
      SELECT d.code, d.nom, d.type_unite,
             (SELECT count(*)::int FROM utilisateurs u WHERE u.departement_id = d.id) AS effectif
      FROM departements d
      WHERE d.actif = TRUE
      ORDER BY effectif DESC, d.nom
      LIMIT 8
    `),
    query(`
      SELECT j.id, j.action, j.statut, j.acteur_email, j.cree_le, j.entite
      FROM journal_audit j
      ORDER BY j.cree_le DESC, j.id DESC
      LIMIT 10
    `),
  ]);

  return {
    compteurs: compteurs.rows[0],
    repartitionStatuts: statuts.rows,
    permissionsParModule: parModule.rows,
    departementsPrincipaux: departements.rows.map((ligne) => ({
      code: ligne.code,
      nom: ligne.nom,
      typeUnite: ligne.type_unite,
      effectif: ligne.effectif,
    })),
    activiteRecente: activite.rows.map((ligne) => ({
      id: ligne.id,
      action: ligne.action,
      statut: ligne.statut,
      acteurEmail: ligne.acteur_email,
      entite: ligne.entite,
      creeLe: ligne.cree_le,
    })),
  };
}