// Service des rapports de la pharmacie : situation journaliere (ou par periode)
// des ventes et de la caisse, par pharmacie ou pour tout le reseau.
//
// Sources des chiffres (chaque module reste proprietaire de sa donnee) :
//   * VENTES        : pharmacie_ventes (+ retours) -> nombre de ventes, chiffre
//                     d'affaires et marge NETS des retours, comme la finance
//                     pharmacie (v_pharmacie_ca_par_point) ;
//   * ENCAISSEMENTS : pharmacie_paiements -> argent reellement encaisse sur la
//                     periode, par mode de paiement ;
//   * CAISSE        : finance_transactions (grand livre) -> entrees et sorties
//                     reelles (ventes, apports, remboursements, depenses,
//                     achats) et solde de la periode ;
//   * DEPENSES      : finance_depenses APPROUVEES de la periode, datees par leur
//                     date d'approbation (valide_le) et non par la date saisie de
//                     la depense : une depense simplement soumise (EN_ATTENTE) ne
//                     doit jamais apparaitre dans les totaux. Leur approbation
//                     genere la sortie correspondante au grand livre, ce qui rend
//                     la section « depenses » coherente avec les sorties de caisse.
//   * DETAIL VENTES : liste PAGINEE servie par `ventesSituation`. Elle est
//                     volontairement separee de la situation : les indicateurs
//                     ne dependent que de la periode et du perimetre, un
//                     changement de page ne relance donc pas les calculs.
//
// Periode : bornes incluses (du / au). Une situation journaliere correspond a
// du = au ; seules des dates deja validees par le schema arrivent ici.
//
// Perimetre : applique en amont par utils/perimetre.js - un PPV ou un
// responsable de pharmacie ne lit QUE sa pharmacie ; la direction (DG, DGA,
// Directeur technique, Comptable, Tresorier, Auditeur) lit une pharmacie
// precise ou l'ensemble du reseau.

import { query } from '../../../config/database.js';

/** Convertit les colonnes NUMERIC (texte pour le pilote pg) en nombres. */
const nombre = (valeur) => Number(valeur ?? 0);

/** Arrondi a deux decimales (montants monetaires). */
const arrondi = (valeur) => Math.round((Number(valeur) || 0) * 100) / 100;

/** Ordre d'affichage des modes de paiement dans les rapports. */
const MODES_PAIEMENT = ['ESPECES', 'MOBILE_MONEY', 'CARTE', 'CHEQUE', 'VIREMENT', 'CREDIT'];

/** Libelles lisibles des modes de paiement (documents imprimes). */
const LIBELLES_MODE = {
  ESPECES: 'Especes',
  MOBILE_MONEY: 'Mobile money',
  CARTE: 'Carte',
  CHEQUE: 'Cheque',
  VIREMENT: 'Virement',
  CREDIT: 'Credit',
};

/**
 * Pagination du detail des ventes (fonction `ventesSituation`).
 *  - ecran : 50 lignes par defaut, 200 au maximum par requete ;
 *  - document (PV / PDF, export CSV) : `complet` renvoie toute la periode,
 *    plafonnee a DETAIL_COMPLET_MAX pour proteger la memoire du serveur.
 */
const DETAIL_LIMITE_DEFAUT = 50;
const DETAIL_LIMITE_MAX = 200;
const DETAIL_COMPLET_MAX = 5000;

/** Jour local au format AAAA-MM-JJ (periode par defaut : aujourd'hui). */
export function jourCourant() {
  const maintenant = new Date();
  const local = new Date(maintenant.getTime() - maintenant.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Nombre de jours calendaires d'une periode (bornes incluses). */
function nombreDeJours(du, au) {
  const debut = Date.parse(`${du}T00:00:00Z`);
  const fin = Date.parse(`${au}T00:00:00Z`);
  if (Number.isNaN(debut) || Number.isNaN(fin)) return 1;
  return Math.max(1, Math.round((fin - debut) / 86_400_000) + 1);
}

/**
 * Parametres et filtre « periode (+ point de vente) » d'une requete.
 * $1 = debut de periode, $2 = fin de periode, $3 = pharmacie (si demandee).
 */
function periodeEtPoint(du, au, pointId, colonnePoint) {
  const parametres = [du, au];
  let clause = '';
  if (pointId) {
    parametres.push(pointId);
    clause = ` AND ${colonnePoint} = $${parametres.length}`;
  }
  return { clause, parametres };
}

/** Cumule des montants par cle, tries par ordre impose ou par montant decroissant. */
function cumuler(lignes, cle, ordre = null) {
  const cumul = new Map();
  for (const ligne of lignes) {
    const valeur = ligne[cle] ?? 'AUTRE';
    cumul.set(valeur, arrondi(nombre(cumul.get(valeur)) + nombre(ligne.montant)));
  }
  const resultat = [...cumul.entries()].map(([valeur, montant]) => ({ valeur, montant }));
  if (ordre) {
    return resultat.sort((a, b) => ordre.indexOf(a.valeur) - ordre.indexOf(b.valeur));
  }
  return resultat.sort((a, b) => b.montant - a.montant);
}

/** Repartition par mode de paiement (libelles inclus). */
function repartitionParMode(lignes) {
  return cumuler(lignes, 'mode', MODES_PAIEMENT).map((entree) => ({
    mode: entree.valeur,
    libelle: LIBELLES_MODE[entree.valeur] ?? entree.valeur,
    montant: entree.montant,
  }));
}

/** Repartition par categorie (montants decroissants). */
function repartitionParCategorie(lignes) {
  return cumuler(lignes, 'categorie').map((entree) => ({
    categorie: entree.valeur,
    montant: entree.montant,
  }));
}

/** Fusionne les series journalieres (ventes, encaissements, flux de caisse). */
function fusionnerSeries(ventes, paiements, flux) {
  const jours = new Map();
  const obtenir = (jour) => {
    if (!jours.has(jour)) {
      jours.set(jour, {
        jour,
        nbVentes: 0,
        chiffreAffaires: 0,
        marge: 0,
        encaisse: 0,
        entrees: 0,
        sorties: 0,
        solde: 0,
      });
    }
    return jours.get(jour);
  };

  for (const ligne of ventes) {
    const cumul = obtenir(ligne.jour);
    cumul.nbVentes = Number(ligne.nb_ventes ?? 0);
    cumul.chiffreAffaires = arrondi(ligne.chiffre_affaires);
    cumul.marge = arrondi(ligne.marge);
  }
  for (const ligne of paiements) obtenir(ligne.jour).encaisse = arrondi(ligne.montant);
  for (const ligne of flux) {
    const cumul = obtenir(ligne.jour);
    cumul.entrees = arrondi(ligne.entrees);
    cumul.sorties = arrondi(ligne.sorties);
  }

  return [...jours.values()]
    .map((cumul) => ({ ...cumul, solde: arrondi(cumul.entrees - cumul.sorties) }))
    .sort((a, b) => a.jour.localeCompare(b.jour));
}

/** SQL : agregat de retours par vente (valeur HT et cout des produits retournes). */
const RETOURS_PAR_VENTE = `
  SELECT rv.vente_id,
         SUM(rl.total_ligne)                 AS montant_ht_retour,
         SUM(rl.cout_unitaire * rl.quantite) AS cout_retour
  FROM pharmacie_retours_ventes rv
  JOIN pharmacie_retours_ventes_lignes rl ON rl.retour_id = rv.id
  GROUP BY rv.vente_id
`;

/**
 * Situation des ventes et de la caisse sur une periode (bornes incluses).
 *
 * @param {object} filtres
 * @param {string} [filtres.pointId] pharmacie (absent = tout le reseau)
 * @param {string} [filtres.du]      premier jour (AAAA-MM-JJ, defaut : aujourd'hui)
 * @param {string} [filtres.au]      dernier jour (AAAA-MM-JJ, defaut : le premier jour)
 * @param {object} [acteur]          utilisateur a l'origine de l'edition du rapport
 */
export async function situation(filtres = {}, acteur = null) {
  const du = filtres.du ?? jourCourant();
  const au = filtres.au ?? du;
  const pointId = filtres.pointId ?? null;

  // Chaque requete porte son propre jeu de parametres ($1 = du, $2 = au, $3 = point).
  const qVentes = periodeEtPoint(du, au, pointId, 'v.point_id');
  const qEncaissements = periodeEtPoint(du, au, pointId, 'v.point_id');
  const qFlux = periodeEtPoint(du, au, pointId, 't.point_id');
  const qDepenses = periodeEtPoint(du, au, pointId, 'd.point_id');
  const qVentesJour = periodeEtPoint(du, au, pointId, 'point_id');
  const qPaiementsJour = periodeEtPoint(du, au, pointId, 'v.point_id');
  const qFluxJour = periodeEtPoint(du, au, pointId, 't.point_id');
  const qTop = periodeEtPoint(du, au, pointId, 'v.point_id');

  const [
    syntheseVentes,
    encaissements,
    flux,
    depenses,
    depensesEnAttente,
    parPoint,
    ventesJour,
    paiementsJour,
    fluxJour,
    topProduits,
    points,
  ] = await Promise.all([

    // 1. Ventes de la periode (toutes les ventes, annulees comprises).
    query(
      `SELECT count(*)::int AS nb_ventes,
              count(*) FILTER (WHERE v.statut = 'ANNULEE')::int AS nb_annulees,
              count(*) FILTER (WHERE v.statut = 'VALIDEE' AND v.reste_a_payer > 0)::int AS nb_ventes_credit,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.total_ht - COALESCE(r.montant_ht_retour, 0) ELSE 0 END), 0) AS total_ht,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.remise ELSE 0 END), 0) AS remise,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.total_tva ELSE 0 END), 0) AS total_tva,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.total_ttc ELSE 0 END), 0) AS total_ttc,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN COALESCE(v.montant_retourne, 0) ELSE 0 END), 0) AS montant_retourne,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.total_ttc - COALESCE(v.montant_retourne, 0) ELSE 0 END), 0) AS chiffre_affaires,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.cout_total - COALESCE(r.cout_retour, 0) ELSE 0 END), 0) AS cout_ventes,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE'
                                THEN v.marge - (COALESCE(r.montant_ht_retour, 0) - COALESCE(r.cout_retour, 0))
                                ELSE 0 END), 0) AS marge,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN COALESCE(v.montant_recu, 0) ELSE 0 END), 0) AS montant_recu,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN COALESCE(v.montant_rendu, 0) ELSE 0 END), 0) AS montant_rendu,
              COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.reste_a_payer ELSE 0 END), 0) AS reste_a_payer
       FROM pharmacie_ventes v
       LEFT JOIN (${RETOURS_PAR_VENTE}) r ON r.vente_id = v.id
       WHERE v.date_vente >= $1::date AND v.date_vente < ($2::date + 1)${qVentes.clause}`,
      qVentes.parametres
    ),
    // 2. Encaissements reels des ventes (date d'encaissement), par mode.
    query(
      `SELECT p.mode, SUM(p.montant) AS montant, count(*)::int AS nb
       FROM pharmacie_paiements p
       JOIN pharmacie_ventes v ON v.id = p.vente_id
       WHERE v.statut = 'VALIDEE'
         AND p.date_paiement >= $1::date AND p.date_paiement < ($2::date + 1)${qEncaissements.clause}
       GROUP BY p.mode
       ORDER BY montant DESC`,
      qEncaissements.parametres
    ),


    // 3. Grand livre : entrees et sorties de caisse des pharmacies.
    query(
      `SELECT t.sens, t.categorie, t.mode, SUM(t.montant) AS montant, count(*)::int AS nb
       FROM finance_transactions t
       JOIN finance_services s ON s.id = t.service_id AND s.type_service = 'PHARMACIE'
       WHERE t.date_transaction >= $1::date AND t.date_transaction < ($2::date + 1)${qFlux.clause}
       GROUP BY t.sens, t.categorie, t.mode
       ORDER BY t.sens, montant DESC`,
      qFlux.parametres
    ),
    // 4. Depenses approuvees de la periode : date d'APPROBATION (valide_le), et
    //    non date de la depense - une depense soumise n'est pas encore comptee.
    query(
      `SELECT d.categorie, d.mode, SUM(d.montant) AS montant, count(*)::int AS nb
       FROM finance_depenses d
       JOIN finance_services s ON s.id = d.service_id AND s.type_service = 'PHARMACIE'
       WHERE d.statut = 'VALIDEE'
         AND d.valide_le >= $1::date AND d.valide_le < ($2::date + 1)${qDepenses.clause}
       GROUP BY d.categorie, d.mode
       ORDER BY montant DESC`,
      qDepenses.parametres
    ),
    // 4 bis. Depenses encore soumises (EN_ATTENTE) sur la periode : information
    //        seule, elles ne sont jamais ajoutées aux totaux de la situation.
    query(
      `SELECT COALESCE(SUM(d.montant), 0) AS montant, count(*)::int AS nb
       FROM finance_depenses d
       JOIN finance_services s ON s.id = d.service_id AND s.type_service = 'PHARMACIE'
       WHERE d.statut = 'EN_ATTENTE'
         AND d.date_depense >= $1::date AND d.date_depense < ($2::date + 1)${qDepenses.clause}`,
      qDepenses.parametres
    ),
    // 5. Detail par pharmacie : ventes de la periode et caisse correspondante.
    query(
      `SELECT po.id AS point_id, po.code AS point_code, po.nom AS point_nom,
              COALESCE(v.nb_ventes, 0)::int   AS nb_ventes,
              COALESCE(v.chiffre_affaires, 0) AS chiffre_affaires,
              COALESCE(v.marge, 0)            AS marge,
              COALESCE(v.reste_a_payer, 0)    AS reste_a_payer,
              COALESCE(p.encaisse, 0)         AS encaisse,
              COALESCE(c.entrees, 0)          AS entrees_caisse,
              COALESCE(c.sorties, 0)          AS sorties_caisse
       FROM pharmacie_points po
       LEFT JOIN (
         SELECT v.point_id,
                count(*) FILTER (WHERE v.statut = 'VALIDEE')::int AS nb_ventes,
                COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.total_ttc - COALESCE(v.montant_retourne, 0) ELSE 0 END), 0) AS chiffre_affaires,
                COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE'
                                  THEN v.marge - (COALESCE(r.montant_ht_retour, 0) - COALESCE(r.cout_retour, 0))
                                  ELSE 0 END), 0) AS marge,
                COALESCE(SUM(CASE WHEN v.statut = 'VALIDEE' THEN v.reste_a_payer ELSE 0 END), 0) AS reste_a_payer
         FROM pharmacie_ventes v
         LEFT JOIN (${RETOURS_PAR_VENTE}) r ON r.vente_id = v.id
         WHERE v.date_vente >= $1::date AND v.date_vente < ($2::date + 1)
         GROUP BY v.point_id
       ) v ON v.point_id = po.id
       LEFT JOIN (
         SELECT v.point_id, SUM(p.montant) AS encaisse
         FROM pharmacie_paiements p
         JOIN pharmacie_ventes v ON v.id = p.vente_id
         WHERE v.statut = 'VALIDEE'
           AND p.date_paiement >= $1::date AND p.date_paiement < ($2::date + 1)
         GROUP BY v.point_id
       ) p ON p.point_id = po.id
       LEFT JOIN (
         SELECT t.point_id,
                COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' THEN t.montant ELSE 0 END), 0) AS entrees,
                COALESCE(SUM(CASE WHEN t.sens = 'SORTIE' THEN t.montant ELSE 0 END), 0) AS sorties
         FROM finance_transactions t
         JOIN finance_services s ON s.id = t.service_id AND s.type_service = 'PHARMACIE'
         WHERE t.point_id IS NOT NULL
           AND t.date_transaction >= $1::date AND t.date_transaction < ($2::date + 1)
         GROUP BY t.point_id
       ) c ON c.point_id = po.id
       WHERE ($3::uuid IS NULL AND po.actif) OR po.id = $3::uuid
       ORDER BY chiffre_affaires DESC, po.nom`,
      [du, au, pointId]
    ),
    // 6. Chiffre d'affaires et marge par jour (vue nette des retours).
    query(
      `SELECT to_char(jour, 'YYYY-MM-DD') AS jour,
              SUM(nb_ventes)::int AS nb_ventes,
              SUM(chiffre_affaires) AS chiffre_affaires,
              SUM(marge) AS marge
       FROM v_pharmacie_ventes_journalieres
       WHERE jour >= $1::date AND jour <= $2::date${qVentesJour.clause}
       GROUP BY jour
       ORDER BY jour`,
      qVentesJour.parametres
    ),
    // 7. Encaissements par jour.
    query(
      `SELECT to_char(p.date_paiement::date, 'YYYY-MM-DD') AS jour, SUM(p.montant) AS montant
       FROM pharmacie_paiements p
       JOIN pharmacie_ventes v ON v.id = p.vente_id
       WHERE v.statut = 'VALIDEE'
         AND p.date_paiement >= $1::date AND p.date_paiement < ($2::date + 1)${qPaiementsJour.clause}
       GROUP BY p.date_paiement::date
       ORDER BY jour`,
      qPaiementsJour.parametres
    ),
    // 8. Entrees et sorties de caisse par jour.
    query(
      `SELECT to_char(t.date_transaction::date, 'YYYY-MM-DD') AS jour,
              COALESCE(SUM(CASE WHEN t.sens = 'ENTREE' THEN t.montant ELSE 0 END), 0) AS entrees,
              COALESCE(SUM(CASE WHEN t.sens = 'SORTIE' THEN t.montant ELSE 0 END), 0) AS sorties
       FROM finance_transactions t
       JOIN finance_services s ON s.id = t.service_id AND s.type_service = 'PHARMACIE'
       WHERE t.date_transaction >= $1::date AND t.date_transaction < ($2::date + 1)${qFluxJour.clause}
       GROUP BY t.date_transaction::date
       ORDER BY jour`,
      qFluxJour.parametres
    ),
    // 9. Detail des ventes : servi par `ventesSituation` (endpoint pagine), il
    //    n'est pas recalcule ici : les indicateurs ne dependent pas de la page.
    // 10. Produits les plus vendus de la periode (annexe du PV).
    query(
      `SELECT pr.nom_commercial,
              SUM(l.quantite)::int AS quantite,
              SUM(l.total_ligne)   AS chiffre_affaires
       FROM pharmacie_ventes_lignes l
       JOIN pharmacie_ventes v ON v.id = l.vente_id
       JOIN pharmacie_produits pr ON pr.id = l.produit_id
       WHERE v.statut = 'VALIDEE'
         AND v.date_vente >= $1::date AND v.date_vente < ($2::date + 1)${qTop.clause}
       GROUP BY pr.nom_commercial
       ORDER BY chiffre_affaires DESC
       LIMIT 10`,
      qTop.parametres
    ),
    // 11. Pharmacies couvertes par le rapport (en-tete du PV).
    query(
      pointId
        ? `SELECT id, code, nom FROM pharmacie_points WHERE id = $1`
        : `SELECT id, code, nom FROM pharmacie_points WHERE actif ORDER BY nom`,
      pointId ? [pointId] : []
    ),
  ]);

  const s = syntheseVentes.rows[0];

  // --- Ventes ---------------------------------------------------------------
  const nbVentes = Number(s.nb_ventes ?? 0);
  const nbAnnulees = Number(s.nb_annulees ?? 0);
  const nbVentesValidees = nbVentes - nbAnnulees;
  const chiffreAffaires = arrondi(s.chiffre_affaires);
  const marge = arrondi(s.marge);

  // --- Encaissements des ventes (par mode de paiement) ----------------------
  const lignesPaiements = encaissements.rows.map((ligne) => ({
    mode: ligne.mode,
    montant: arrondi(ligne.montant),
    nb: Number(ligne.nb ?? 0),
  }));

  // --- Caisse : flux du grand livre ----------------------------------------
  const entreesFlux = flux.rows.filter((ligne) => ligne.sens === 'ENTREE');
  const sortiesFlux = flux.rows.filter((ligne) => ligne.sens === 'SORTIE');
  const totalEntrees = arrondi(entreesFlux.reduce((total, ligne) => total + nombre(ligne.montant), 0));
  const totalSorties = arrondi(sortiesFlux.reduce((total, ligne) => total + nombre(ligne.montant), 0));

  // --- Depenses approuvees (+ depenses en attente, hors totaux) --------------
  const totalDepenses = arrondi(depenses.rows.reduce((total, ligne) => total + nombre(ligne.montant), 0));
  const attente = depensesEnAttente.rows[0] ?? {};

  return {
    periode: { du, au, jours: nombreDeJours(du, au), journaliere: du === au },
    portee: {
      globale: !pointId,
      pointId,
      pointNom: pointId ? points.rows[0]?.nom ?? null : null,
      points: points.rows.map((ligne) => ({ id: ligne.id, code: ligne.code, nom: ligne.nom })),
    },
    edite: { le: new Date().toISOString(), parNom: nomActeur(acteur) },
    ventes: {
      nbVentes,
      nbVentesValidees,
      nbAnnulees,
      nbVentesCredit: Number(s.nb_ventes_credit ?? 0),
      totalHT: arrondi(s.total_ht),
      remise: arrondi(s.remise),
      totalTVA: arrondi(s.total_tva),
      totalTTC: arrondi(s.total_ttc),
      montantRetourne: arrondi(s.montant_retourne),
      chiffreAffaires,
      coutVentes: arrondi(s.cout_ventes),
      marge,
      tauxMarge: chiffreAffaires > 0 ? arrondi((marge / chiffreAffaires) * 100) : 0,
      panierMoyen: nbVentesValidees > 0 ? arrondi(chiffreAffaires / nbVentesValidees) : 0,
      montantRecu: arrondi(s.montant_recu),
      montantRendu: arrondi(s.montant_rendu),
      resteAPayer: arrondi(s.reste_a_payer),
    },
    encaissements: {
      total: arrondi(lignesPaiements.reduce((total, ligne) => total + ligne.montant, 0)),
      lignes: lignesPaiements,
      parMode: repartitionParMode(lignesPaiements),
    },
    caisse: {
      entrees: {
        total: totalEntrees,
        parCategorie: repartitionParCategorie(entreesFlux),
        parMode: repartitionParMode(entreesFlux),
      },
      sorties: {
        total: totalSorties,
        parCategorie: repartitionParCategorie(sortiesFlux),
        parMode: repartitionParMode(sortiesFlux),
      },
      solde: arrondi(totalEntrees - totalSorties),
    },
    depenses: {
      total: totalDepenses,
      nb: depenses.rows.reduce((total, ligne) => total + Number(ligne.nb ?? 0), 0),
      /** Depenses soumises mais non encore approuvees : information, hors totaux. */
      enAttente: { total: arrondi(attente.montant), nb: Number(attente.nb ?? 0) },
      parCategorie: repartitionParCategorie(depenses.rows),
      parMode: repartitionParMode(depenses.rows),
    },
    parPoint: parPoint.rows.map((ligne) => {
      const entrees = arrondi(ligne.entrees_caisse);
      const sorties = arrondi(ligne.sorties_caisse);
      return {
        pointId: ligne.point_id,
        pointCode: ligne.point_code,
        pointNom: ligne.point_nom,
        nbVentes: Number(ligne.nb_ventes ?? 0),
        chiffreAffaires: arrondi(ligne.chiffre_affaires),
        marge: arrondi(ligne.marge),
        resteAPayer: arrondi(ligne.reste_a_payer),
        encaisse: arrondi(ligne.encaisse),
        entreesCaisse: entrees,
        sortiesCaisse: sorties,
        soldeCaisse: arrondi(entrees - sorties),
      };
    }),
    parJour: fusionnerSeries(ventesJour.rows, paiementsJour.rows, fluxJour.rows),
    topProduits: topProduits.rows.map((ligne) => ({
      nomCommercial: ligne.nom_commercial,
      quantite: Number(ligne.quantite ?? 0),
      chiffreAffaires: arrondi(ligne.chiffre_affaires),
    })),
  };
}

/**
 * Detail des ventes d'une periode, PAGINE (une page par appel) ou complet.
 *
 * Cette fonction est volontairement separee de `situation` : les indicateurs
 * (chiffre d'affaires, caisse, depenses...) ne dependent que de la periode et du
 * perimetre, pas de la page affichee. Changer de page ne relance donc QUE cette
 * requete.
 *
 * @param {object} filtres
 * @param {string} [filtres.pointId] pharmacie (absent = tout le reseau)
 * @param {string} [filtres.du]      premier jour (AAAA-MM-JJ, defaut : aujourd'hui)
 * @param {string} [filtres.au]      dernier jour (AAAA-MM-JJ, defaut : le premier jour)
 * @param {number} [filtres.page]    page demandee (1 par defaut)
 * @param {number} [filtres.limite]  lignes par page (50 par defaut, 200 max)
 * @param {boolean} [filtres.complet] toute la periode (document : PV / PDF, CSV)
 * @returns {{ donnees: object[], pagination: object, tronque: boolean }}
 */
export async function ventesSituation(filtres = {}) {
  const du = filtres.du ?? jourCourant();
  const au = filtres.au ?? du;
  const pointId = filtres.pointId ?? null;

  const complet = filtres.complet === true;
  const page = complet ? 1 : Math.max(1, Number(filtres.page) || 1);
  const limite = complet
    ? DETAIL_COMPLET_MAX
    : Math.min(Math.max(1, Number(filtres.limite) || DETAIL_LIMITE_DEFAUT), DETAIL_LIMITE_MAX);
  const decalage = complet ? 0 : (page - 1) * limite;

  const q = periodeEtPoint(du, au, pointId, 'v.point_id');
  // `count(*) OVER()` donne le total de la periode (toutes pages) en une passe.
  const { rows } = await query(
    `SELECT v.numero, v.date_vente, v.type_vente, v.statut,
            v.total_ttc, COALESCE(v.montant_retourne, 0) AS montant_retourne,
            v.total_paye, v.reste_a_payer,
            c.nom AS client_nom, po.nom AS point_nom,
            (u.nom || ' ' || u.prenom) AS vendeur_nom,
            count(*) OVER() AS total
     FROM pharmacie_ventes v
     JOIN pharmacie_points po ON po.id = v.point_id
     LEFT JOIN pharmacie_clients c ON c.id = v.client_id
     LEFT JOIN utilisateurs u ON u.id = v.vendeur_id
     WHERE v.date_vente >= $1::date AND v.date_vente < ($2::date + 1)${q.clause}
     ORDER BY v.date_vente DESC, v.numero DESC
     LIMIT $${q.parametres.length + 1} OFFSET $${q.parametres.length + 2}`,
    [...q.parametres, limite, decalage]
  );

  const total = Number(rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limite));

  return {
    donnees: rows.map((ligne) => ({
      numero: ligne.numero,
      dateVente: ligne.date_vente,
      typeVente: ligne.type_vente,
      statut: ligne.statut,
      pointNom: ligne.point_nom,
      clientNom: ligne.client_nom ?? null,
      vendeurNom: ligne.vendeur_nom ?? null,
      totalTTC: arrondi(ligne.total_ttc),
      montantRetourne: arrondi(ligne.montant_retourne),
      totalPaye: arrondi(ligne.total_paye),
      resteAPayer: arrondi(ligne.reste_a_payer),
    })),
    pagination: {
      page,
      limite,
      total,
      totalPages,
      aSuivante: page < totalPages,
      aPrecedente: page > 1,
    },
    /** Vrai uniquement en mode complet si la periode depasse le plafond. */
    tronque: complet && total > rows.length,
  };
}

/** Nom lisible de l'auteur du rapport (ou son e-mail). */
function nomActeur(acteur) {
  if (!acteur) return null;
  const nom = `${acteur.prenom ?? ''} ${acteur.nom ?? ''}`.trim();
  return nom || acteur.email || null;
}
