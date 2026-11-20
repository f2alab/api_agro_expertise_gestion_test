// Service du tableau de bord de la Direction (DG / DGA / Direction technique).
// Vue d'ensemble consolidée : activite IAM, pharmacie et finance multi-services.
// La finance provient de la base UNIQUE (grand livre finance_transactions), ce
// qui couvre toutes les activites du groupe (pharmacies, clinique, laboratoire).

import { query } from '../../config/database.js';
import { indicateurs as indicateursPharmacie } from '../pharmacie/finance/finance.service.js';
import { indicateurs as indicateursFinance } from '../finances/finances.service.js';

/** Tableau de bord consolide destine a la direction generale. */
export async function tableauDeBordDirection() {
  const [iam, pharmacieCompteurs] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*)::int FROM utilisateurs WHERE statut = 'ACTIF')            AS utilisateurs_actifs,
         (SELECT count(*)::int FROM departements WHERE actif)                        AS departements_actifs,
         (SELECT count(*)::int FROM roles WHERE actif)                               AS roles_actifs,
         (SELECT count(*)::int FROM jetons_rafraichissement
           WHERE revoque_le IS NULL AND expire_le > now())                           AS sessions_actives,
         (SELECT count(*)::int FROM journal_audit
           WHERE statut = 'ECHEC' AND cree_le > now() - interval '24 hours')        AS echecs_24h`
    ),
    query(
      `SELECT
         (SELECT count(*)::int FROM pharmacie_points WHERE actif)                    AS points_actifs,
         (SELECT count(*)::int FROM pharmacie_ventes
           WHERE statut = 'VALIDEE' AND date_vente::date = CURRENT_DATE)             AS ventes_jour,
         (SELECT count(*)::int FROM v_pharmacie_alertes_stock WHERE alerte_stock <> 'OK') AS alertes_stock,
         (SELECT count(*)::int FROM pharmacie_clients WHERE actif)                       AS clients_actifs`
    ),
  ]);

  const [pharmacie, finance] = await Promise.all([
    indicateursPharmacie({}),
    // Portée globale : la direction voit toutes les activités du groupe.
    indicateursFinance({}, { superAdmin: true, porteeGlobale: true }),
  ]);

  const financeConsolidee = {
    entrees: finance.synthese.entrees,
    sorties: finance.synthese.sorties,
    solde: finance.synthese.solde,
    chiffreAffaires: finance.synthese.entrees,
    marge: pharmacie.synthese.marge,
    valeurStock: pharmacie.synthese.valeurStock,
    encaisse: pharmacie.synthese.encaisse,
  };

  return {
    iam: iam.rows[0],
    pharmacie: {
      compteurs: pharmacieCompteurs.rows[0],
      parPoint: pharmacie.parPoint,
      topProduits: pharmacie.topProduits,
      serieJournaliere: pharmacie.serieJournaliere,
    },
    // Détail par service (pharmacie, consultation, analyse...) issu du grand livre.
    financeParService: finance.parService,
    financeParTypeService: finance.parTypeService,
    financeParMode: finance.parMode,
    financeConsolidee,
    modules: {
      pharmacie: {
        chiffreAffaires: pharmacie.synthese.chiffreAffaires,
        marge: pharmacie.synthese.marge,
        valeurStock: pharmacie.synthese.valeurStock,
        encaisse: pharmacie.synthese.encaisse,
      },
      global: {
        entrees: finance.synthese.entrees,
        sorties: finance.synthese.sorties,
        solde: finance.synthese.solde,
      },
    },
  };
}