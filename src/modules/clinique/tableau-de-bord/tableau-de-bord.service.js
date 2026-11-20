// Service du tableau de bord de la clinique.
// Indicateurs d'activité : passages, file d'attente, encaissements, examens et
// ordonnances. Les agrégats portent sur la période demandée (défaut : tout).

import { query } from '../../../config/database.js';

/** Construit la clause de période sur `accueil_le` (bornes incluses). */
function clausePeriode(filtres, parametres) {
  const conditions = ["c.statut <> 'ANNULEE'"];
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`c.accueil_le >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`c.accueil_le < ($${parametres.length}::date + interval '1 day')`);
  }
  return conditions.join(' AND ');
}

/** Indicateurs consolidés de la clinique. */
export async function indicateursClinique(filtres = {}) {
  const parametres = [];
  const clause = clausePeriode(filtres, parametres);

  const [totaux, parStatut, paracliniques, ordonnances, motifs, factures, file] =
    await Promise.all([
      query(
        `SELECT count(*)::int                                  AS nb_consultations,
                count(*) FILTER (WHERE c.frais_payes)::int     AS nb_payees,
                COALESCE(SUM(c.montant_frais_paye), 0)         AS frais_encaisses,
                COALESCE(SUM(c.frais_consultation), 0)         AS frais_attendus,
                count(*) FILTER (WHERE c.statut = 'CLOTURE')::int AS nb_cloturees
         FROM clinique_consultations c
         WHERE ${clause}`,
        parametres
      ),
      query(
        `SELECT c.statut, count(*)::int AS total
         FROM clinique_consultations c
         WHERE ${clause}
         GROUP BY c.statut`,
        parametres
      ),
      query(
        `SELECT e.statut, count(*)::int AS total, COALESCE(SUM(e.montant), 0) AS montant
         FROM clinique_examens_paracliniques e
         JOIN clinique_consultations c ON c.id = e.consultation_id
         WHERE ${clause}
         GROUP BY e.statut`,
        parametres
      ),
      query(
        `SELECT o.statut, count(*)::int AS total
         FROM clinique_ordonnances o
         JOIN clinique_consultations c ON c.id = o.consultation_id
         WHERE ${clause}
         GROUP BY o.statut`,
        parametres
      ),
      query(
        `SELECT c.motif, count(*)::int AS total
         FROM clinique_consultations c
         WHERE ${clause}
         GROUP BY c.motif
         ORDER BY total DESC
         LIMIT 5`,
        parametres
      ),
      query(
        `SELECT count(*)::int                                   AS nb_factures,
                COALESCE(SUM(f.montant_total), 0)                AS montant_facture,
                COALESCE(SUM(f.total_paye), 0)                   AS montant_encaisse,
                COALESCE(SUM(f.reste_a_payer), 0)                AS reste_a_payer
         FROM clinique_factures f
         WHERE f.statut <> 'ANNULEE'`,
        []
      ),
      query('SELECT count(*)::int AS total FROM v_clinique_file_attente'),
    ]);

  const totauxLigne = totaux.rows[0];
  return {
    nbConsultations: totauxLigne.nb_consultations ?? 0,
    nbPayees: totauxLigne.nb_payees ?? 0,
    nbCloturees: totauxLigne.nb_cloturees ?? 0,
    fraisEncaisses: Number(totauxLigne.frais_encaisses ?? 0),
    fraisAttendus: Number(totauxLigne.frais_attendus ?? 0),
    fileAttente: file.rows[0].total ?? 0,
    parStatut: parStatut.rows.map((ligne) => ({ statut: ligne.statut, total: ligne.total })),
    paracliniques: paracliniques.rows.map((ligne) => ({
      statut: ligne.statut,
      total: ligne.total,
      montant: Number(ligne.montant ?? 0),
    })),
    ordonnances: ordonnances.rows.map((ligne) => ({ statut: ligne.statut, total: ligne.total })),
    topMotifs: motifs.rows.map((ligne) => ({ motif: ligne.motif, total: ligne.total })),
    factures: {
      nb: factures.rows[0].nb_factures ?? 0,
      montantFacture: Number(factures.rows[0].montant_facture ?? 0),
      montantEncaisse: Number(factures.rows[0].montant_encaisse ?? 0),
      resteAPayer: Number(factures.rows[0].reste_a_payer ?? 0),
    },
  };
}