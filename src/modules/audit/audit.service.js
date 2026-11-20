
// Service d'audit : enregistrement et consultation du journal des actions
// sensibles (connexions, création/modification d'utilisateurs et de rôles...).

import { query } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { lirePagination, reponsePaginee } from '../../utils/pagination.js';

/**
 * Enregistre un événement d'audit.
 * Ne lève jamais d'exception : une panne d'audit ne doit pas bloquer le métier.
 *
 * @param {object} evenement
 * @param {string} evenement.action      ex. CONNEXION, CREATION_UTILISATEUR
 * @param {object} [evenement.req]       requête Express (ip, user-agent)
 * @param {string} [evenement.utilisateurId]
 * @param {string} [evenement.acteurEmail]
 * @param {string} [evenement.entite]    utilisateur | role | departement | session
 * @param {string} [evenement.entiteId]
 * @param {'SUCCES'|'ECHEC'} [evenement.statut]
 * @param {object} [evenement.details]
 * @param {string} [evenement.module]
 */
export async function enregistrerAudit({
  action,
  req = null,
  utilisateurId = null,
  acteurEmail = null,
  entite = null,
  entiteId = null,
  statut = 'SUCCES',
  details = null,
  module = 'iam',
}) {
  try {
    await query(
      `INSERT INTO journal_audit
         (utilisateur_id, acteur_email, action, module, entite, entite_id, statut,
          adresse_ip, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        utilisateurId,
        acteurEmail,
        action,
        module,
        entite,
        entiteId,
        statut,
        req ? String(req.ip ?? '').slice(0, 60) : null,
        req ? String(req.headers['user-agent'] ?? '').slice(0, 500) : null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (erreur) {
    logger.warn("Impossible d'écrire dans le journal d'audit", erreur.message);
  }
}

/** Liste paginée du journal d'audit, avec filtres. */
export async function listerAudit({ page, limite, action, utilisateurId, statut, module, recherche }) {
  const { page: pageNum, limite: limiteNum, offset } = lirePagination({ page, limite });
  const conditions = [];
  const parametres = [];

  if (action) {
    parametres.push(`%${action}%`);
    conditions.push(`j.action ILIKE $${parametres.length}`);
  }
  if (utilisateurId) {
    parametres.push(utilisateurId);
    conditions.push(`j.utilisateur_id = $${parametres.length}`);
  }
  if (statut) {
    parametres.push(statut);
    conditions.push(`j.statut = $${parametres.length}`);
  }
  if (module) {
    parametres.push(module);
    conditions.push(`j.module = $${parametres.length}`);
  }
  if (recherche) {
    parametres.push(`%${recherche}%`);
    conditions.push(
      `(j.acteur_email ILIKE $${parametres.length} OR j.entite ILIKE $${parametres.length})`
    );
  }

  const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM journal_audit j ${clauseWhere}`, parametres),
    query(
      `SELECT j.id, j.action, j.module, j.entite, j.entite_id, j.statut,
              j.adresse_ip, j.user_agent, j.details, j.cree_le,
              j.utilisateur_id, j.acteur_email,
              u.nom, u.prenom,
              c.nom AS cible_nom, c.prenom AS cible_prenom, c.email AS cible_email,
              c.matricule AS cible_matricule, c.statut AS cible_statut
       FROM journal_audit j
       LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
       -- Compte visé par l'événement (entite_id pointe vers utilisateurs.id)
       LEFT JOIN utilisateurs c ON j.entite = 'utilisateur' AND c.id::text = j.entite_id
       ${clauseWhere}
       ORDER BY j.cree_le DESC, j.id DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limiteNum, offset]
    ),
  ]);

  const donnees = liste.rows.map((ligne) => ({
    id: ligne.id,
    action: ligne.action,
    module: ligne.module,
    entite: ligne.entite,
    entiteId: ligne.entite_id,
    statut: ligne.statut,
    adresseIp: ligne.adresse_ip,
    userAgent: ligne.user_agent,
    details: ligne.details,
    creeLe: ligne.cree_le,
    acteur: {
      id: ligne.utilisateur_id,
      email: ligne.acteur_email,
      nomComplet: ligne.nom ? `${ligne.nom} ${ligne.prenom}` : null,
    },
    // Compte visé (archivage, réinitialisation, affectation de rôles...)
    cible: ligne.cible_email
      ? {
          id: ligne.entite_id,
          nomComplet: `${ligne.cible_nom} ${ligne.cible_prenom}`.trim(),
          email: ligne.cible_email,
          matricule: ligne.cible_matricule,
          statut: ligne.cible_statut,
        }
      : null,
  }));

  return reponsePaginee(donnees, compteur.rows[0].total, { page: pageNum, limite: limiteNum });
}