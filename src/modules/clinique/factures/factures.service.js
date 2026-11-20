// Service des factures globales de la clinique.
// Une facture regroupe les rubriques d'un passage (frais de consultation,
// examens paracliniques, montant de l'ordonnance, autres frais). Le caissier
// choisit les rubriques incluses ; les montants sont figés à l'émission.

import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { enregistrerFlux } from '../../finances/ledger.service.js';
import {
  SERVICE_FINANCE_ANALYSE,
  SERVICE_FINANCE_CONSULTATION,
  arrondi,
  genererNumero,
  resoudreServiceFinance,
} from '../clinique.service.js';
import { exigerConsultation } from '../consultations/consultations.service.js';

// Facture + consultation, animal, propriétaire et caissier.
const SELECT_FACTURE = `
  SELECT f.id, f.numero, f.consultation_id, f.animal_id, f.proprietaire_id,
         f.inclure_consultation, f.inclure_examens, f.inclure_ordonnance, f.inclure_autres,
         f.montant_consultation, f.montant_examens, f.montant_ordonnance, f.montant_autres,
         f.montant_total, f.statut, f.mode_paiement, f.total_paye, f.reste_a_payer,
         f.commentaire, f.date_facture, f.created_at, f.updated_at,
         c.numero AS consultation_numero,
         a.code AS animal_code, a.nom AS animal_nom, a.espece,
         p.code AS proprietaire_code, p.nom AS proprietaire_nom,
         p.telephone AS proprietaire_telephone,
         (u.nom || ' ' || u.prenom) AS generee_par_nom
  FROM clinique_factures f
  LEFT JOIN clinique_consultations c ON c.id = f.consultation_id
  LEFT JOIN clinique_animaux a        ON a.id = f.animal_id
  LEFT JOIN clinique_proprietaires p  ON p.id = f.proprietaire_id
  LEFT JOIN utilisateurs u            ON u.id = f.generee_par
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserFacture(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    numero: ligne.numero,
    consultationId: ligne.consultation_id ?? null,
    consultationNumero: ligne.consultation_numero ?? null,
    animalId: ligne.animal_id ?? null,
    animalCode: ligne.animal_code ?? null,
    animalNom: ligne.animal_nom ?? null,
    espece: ligne.espece ?? null,
    proprietaireId: ligne.proprietaire_id ?? null,
    proprietaireCode: ligne.proprietaire_code ?? null,
    proprietaireNom: ligne.proprietaire_nom ?? null,
    proprietaireTelephone: ligne.proprietaire_telephone ?? null,
    inclureConsultation: Boolean(ligne.inclure_consultation),
    inclureExamens: Boolean(ligne.inclure_examens),
    inclureOrdonnance: Boolean(ligne.inclure_ordonnance),
    inclureAutres: Boolean(ligne.inclure_autres),
    montantConsultation: Number(ligne.montant_consultation ?? 0),
    montantExamens: Number(ligne.montant_examens ?? 0),
    montantOrdonnance: Number(ligne.montant_ordonnance ?? 0),
    montantAutres: Number(ligne.montant_autres ?? 0),
    montantTotal: Number(ligne.montant_total ?? 0),
    statut: ligne.statut,
    modePaiement: ligne.mode_paiement ?? null,
    totalPaye: Number(ligne.total_paye ?? 0),
    resteAPayer: Number(ligne.reste_a_payer ?? 0),
    commentaire: ligne.commentaire ?? null,
    genereeParNom: ligne.generee_par_nom ?? null,
    dateFacture: ligne.date_facture,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Lignes de détail d'une facture. */
export async function listerLignes(factureId) {
  const { rows } = await query(
    `SELECT id, rubrique, designation, quantite, prix_unitaire, montant,
            reference_type, reference_id, ordre
     FROM clinique_factures_lignes
     WHERE facture_id = $1
     ORDER BY ordre, id`,
    [factureId]
  );
  return rows.map((ligne) => ({
    id: ligne.id,
    rubrique: ligne.rubrique,
    designation: ligne.designation,
    quantite: Number(ligne.quantite ?? 0),
    prixUnitaire: Number(ligne.prix_unitaire ?? 0),
    montant: Number(ligne.montant ?? 0),
    referenceType: ligne.reference_type ?? null,
    referenceId: ligne.reference_id ?? null,
  }));
}

/** Liste des factures (filtres statut, période, animal, propriétaire). */
export async function listerFactures(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`f.statut = $${parametres.length}`);
  }
  if (filtres.consultationId) {
    parametres.push(filtres.consultationId);
    conditions.push(`f.consultation_id = $${parametres.length}`);
  }
  if (filtres.animalId) {
    parametres.push(filtres.animalId);
    conditions.push(`f.animal_id = $${parametres.length}`);
  }
  if (filtres.proprietaireId) {
    parametres.push(filtres.proprietaireId);
    conditions.push(`f.proprietaire_id = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`f.date_facture >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`f.date_facture < ($${parametres.length}::date + interval '1 day')`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(f.numero ILIKE $${i} OR a.nom ILIKE $${i} OR p.nom ILIKE $${i} OR c.numero ILIKE $${i})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_FACTURE} ${clause} ORDER BY f.date_facture DESC LIMIT 500`,
    parametres
  );
  return rows.map(serialiserFacture);
}

/** Récupère une facture (avec ses lignes et le détail des produits) ou null. */
export async function obtenirFacture(id) {
  const { rows } = await query(`${SELECT_FACTURE} WHERE f.id = $1`, [id]);
  if (!rows[0]) return null;
  const facture = serialiserFacture(rows[0]);
  facture.lignes = await listerLignes(id);

  // Détail produit par produit : la facture ne stocke qu'une ligne agrégée par
  // ordonnance, mais le document imprimé liste chaque produit prescrit.
  const ordonnanceIds = [
    ...new Set(
      facture.lignes
        .filter((ligne) => ligne.rubrique === 'PRODUIT' && ligne.referenceId)
        .map((ligne) => ligne.referenceId)
    ),
  ];

  if (ordonnanceIds.length > 0) {
    const detail = await query(
      `SELECT ordonnance_id, designation, quantite, prix_unitaire
       FROM clinique_ordonnances_lignes
       WHERE ordonnance_id = ANY($1::uuid[])
       ORDER BY ordre, created_at`,
      [ordonnanceIds]
    );

    const produitsParOrdonnance = new Map();
    for (const ligne of detail.rows) {
      const liste = produitsParOrdonnance.get(ligne.ordonnance_id) ?? [];
      liste.push({
        designation: ligne.designation,
        quantite: Number(ligne.quantite ?? 0),
        montant: arrondi(Number(ligne.quantite ?? 0) * Number(ligne.prix_unitaire ?? 0)),
      });
      produitsParOrdonnance.set(ligne.ordonnance_id, liste);
    }

    for (const ligne of facture.lignes) {
      if (ligne.rubrique === 'PRODUIT' && ligne.referenceId) {
        ligne.produits = produitsParOrdonnance.get(ligne.referenceId) ?? [];
      }
    }
  }

  return facture;
}

/** Facture ou 404. */
export async function exigerFacture(id) {
  const facture = await obtenirFacture(id);
  if (!facture) throw ApiError.notFound('Facture introuvable.', 'FACTURE_INTROUVABLE');
  return facture;
}

/**
 * Calcule les montants des rubriques d'une facture sans rien enregistrer.
 * Sert à l'aperçu affiché au caissier avant validation.
 *
 * Règles de calcul :
 *   - consultation : frais figés de la consultation ;
 *   - examens    : somme des examens paracliniques non annulés ;
 *   - ordonnance : somme des ordonnances encore à servir (les ordonnances déjà
 *                  servies sont réglées sur le reçu de la pharmacie) ;
 *   - autres     : montant libre saisi par le caissier.
 * « Déjà payé » ne compte que les frais de consultation et les examens encaissés
 * afin qu'un règlement global ne soit jamais compté deux fois au grand livre.
 */
export async function calculerRubriques(consultationId, options = {}) {
  const consultation = await exigerConsultation(consultationId);

  const inclureConsultation = options.inclureConsultation ?? true;
  const inclureExamens = options.inclureExamens ?? true;
  const inclureOrdonnance = options.inclureOrdonnance ?? true;
  const inclureAutres = options.inclureAutres ?? true;

  const [examens, ordonnances] = await Promise.all([
    query(
      `SELECT id, numero, libelle, montant, paye
       FROM clinique_examens_paracliniques
       WHERE consultation_id = $1 AND statut <> 'ANNULE'
       ORDER BY demande_le`,
      [consultationId]
    ),
    query(
      `SELECT o.id, o.numero,
              (SELECT count(*)::int FROM clinique_ordonnances_lignes l
                WHERE l.ordonnance_id = o.id) AS nb_lignes,
              (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0)
                 FROM clinique_ordonnances_lignes l WHERE l.ordonnance_id = o.id) AS montant
       FROM clinique_ordonnances o
       WHERE o.consultation_id = $1 AND o.statut = 'EMISE'
       ORDER BY o.created_at`,
      [consultationId]
    ),
  ]);

  const montantConsultation = inclureConsultation
    ? arrondi(consultation.fraisConsultation)
    : 0;
  const montantExamens = inclureExamens
    ? arrondi(examens.rows.reduce((total, ligne) => total + Number(ligne.montant ?? 0), 0))
    : 0;
  const montantOrdonnance = inclureOrdonnance
    ? arrondi(ordonnances.rows.reduce((total, ligne) => total + Number(ligne.montant ?? 0), 0))
    : 0;
  const montantAutres = inclureAutres ? arrondi(options.montantAutres ?? 0) : 0;

  const montantTotal = arrondi(
    montantConsultation + montantExamens + montantOrdonnance + montantAutres
  );

  const dejaPaye = arrondi(
    (inclureConsultation ? consultation.montantFraisPaye : 0) +
      (inclureExamens
        ? examens.rows
            .filter((ligne) => ligne.paye)
            .reduce((total, ligne) => total + Number(ligne.montant ?? 0), 0)
        : 0)
  );

  return {
    consultation,
    inclureConsultation,
    inclureExamens,
    inclureOrdonnance,
    inclureAutres,
    montantConsultation,
    montantExamens,
    montantOrdonnance,
    montantAutres,
    montantTotal,
    dejaPaye,
    resteAPayer: arrondi(Math.max(montantTotal - dejaPaye, 0)),
    examens: examens.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      libelle: ligne.libelle,
      montant: Number(ligne.montant ?? 0),
      paye: Boolean(ligne.paye),
    })),
    ordonnances: ordonnances.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      nbLignes: ligne.nb_lignes ?? 0,
      montant: Number(ligne.montant ?? 0),
    })),
  };
}

/** Aperçu d'une facture (aucune écriture en base). */
export async function apercuFacture(consultationId, options = {}) {
  const rubriques = await calculerRubriques(consultationId, options);
  return {
    consultationId: rubriques.consultation.id,
    consultationNumero: rubriques.consultation.numero,
    animalNom: rubriques.consultation.animalNom,
    animalCode: rubriques.consultation.animalCode,
    proprietaireNom: rubriques.consultation.proprietaireNom,
    inclureConsultation: rubriques.inclureConsultation,
    inclureExamens: rubriques.inclureExamens,
    inclureOrdonnance: rubriques.inclureOrdonnance,
    inclureAutres: rubriques.inclureAutres,
    montantConsultation: rubriques.montantConsultation,
    montantExamens: rubriques.montantExamens,
    montantOrdonnance: rubriques.montantOrdonnance,
    montantAutres: rubriques.montantAutres,
    montantTotal: rubriques.montantTotal,
    dejaPaye: rubriques.dejaPaye,
    resteAPayer: rubriques.resteAPayer,
    examens: rubriques.examens,
    ordonnances: rubriques.ordonnances,
  };
}

/** Génère la facture globale d'un passage (montants et lignes figés). */
export async function genererFacture(donnees, utilisateur = null) {
  const rubriques = await calculerRubriques(donnees.consultationId, donnees);
  const { consultation } = rubriques;

  if (consultation.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette consultation est annulée.', 'CONSULTATION_ANNULEE');
  }
  if (rubriques.montantTotal <= 0) {
    throw ApiError.badRequest(
      'Aucune rubrique à facturer : sélectionnez au moins un montant.',
      'FACTURE_VIDE'
    );
  }

  const numero = await genererNumero('FACT');
  const statut =
    rubriques.resteAPayer <= 0 ? 'PAYEE' : rubriques.dejaPaye > 0 ? 'PARTIELLE' : 'EMISE';

  const factureId = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO clinique_factures
         (numero, consultation_id, animal_id, proprietaire_id,
          inclure_consultation, inclure_examens, inclure_ordonnance, inclure_autres,
          montant_consultation, montant_examens, montant_ordonnance, montant_autres,
          montant_total, statut, total_paye, reste_a_payer, commentaire, generee_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        numero,
        consultation.id,
        consultation.animalId,
        consultation.proprietaireId,
        rubriques.inclureConsultation,
        rubriques.inclureExamens,
        rubriques.inclureOrdonnance,
        rubriques.inclureAutres,
        rubriques.montantConsultation,
        rubriques.montantExamens,
        rubriques.montantOrdonnance,
        rubriques.montantAutres,
        rubriques.montantTotal,
        statut,
        rubriques.dejaPaye,
        rubriques.resteAPayer,
        donnees.commentaire ?? null,
        utilisateur?.id ?? null,
      ]
    );
    const id = rows[0].id;

    let ordre = 0;
    const ajouterLigne = async (rubrique, designation, montant, referenceType, referenceId) => {
      await client.query(
        `INSERT INTO clinique_factures_lignes
           (facture_id, rubrique, designation, quantite, prix_unitaire, montant,
            reference_type, reference_id, ordre)
         VALUES ($1,$2,$3,1,$4,$4,$5,$6,$7)`,
        [id, rubrique, designation, montant, referenceType, referenceId, ordre]
      );
      ordre += 1;
    };

    if (rubriques.inclureConsultation && rubriques.montantConsultation > 0) {
      await ajouterLigne(
        'CONSULTATION',
        `Frais de consultation ${consultation.numero}`,
        rubriques.montantConsultation,
        'CONSULTATION',
        consultation.id
      );
    }
    if (rubriques.inclureExamens) {
      for (const examen of rubriques.examens) {
        if (examen.montant <= 0) continue;
        await ajouterLigne(
          'EXAMEN',
          `${examen.libelle} (${examen.numero})`,
          examen.montant,
          'PARACLINIQUE',
          examen.id
        );
      }
    }
    if (rubriques.inclureOrdonnance) {
      for (const ordonnance of rubriques.ordonnances) {
        if (ordonnance.montant <= 0) continue;
        await ajouterLigne(
          'PRODUIT',
          `Ordonnance ${ordonnance.numero} (${ordonnance.nbLignes} produit(s))`,
          ordonnance.montant,
          'ORDONNANCE',
          ordonnance.id
        );
      }
    }
    if (rubriques.inclureAutres && rubriques.montantAutres > 0) {
      await ajouterLigne(
        'AUTRE',
        donnees.designationAutres ?? 'Autres frais',
        rubriques.montantAutres,
        null,
        null
      );
    }

    return id;
  });

  return obtenirFacture(factureId);
}

/** Encaisse tout ou partie du reste à payer d'une facture. */
export async function encaisserFacture(id, donnees, utilisateur = null) {
  const facture = await exigerFacture(id);

  if (facture.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette facture est annulée.', 'FACTURE_ANNULEE');
  }
  if (facture.resteAPayer <= 0) {
    throw ApiError.conflict('Cette facture est déjà soldée.', 'FACTURE_SOLDEE');
  }

  const montant = arrondi(donnees.montant);
  if (montant <= 0) {
    throw ApiError.badRequest('Le montant réglé est invalide.', 'MONTANT_INVALIDE');
  }
  if (montant > facture.resteAPayer) {
    throw ApiError.badRequest(
      'Le règlement dépasse le reste à payer.',
      'MONTANT_SUPERIEUR',
      { resteAPayer: facture.resteAPayer, montant }
    );
  }

  const totalPaye = arrondi(facture.totalPaye + montant);
  const reste = arrondi(Math.max(facture.montantTotal - totalPaye, 0));
  const statut = reste <= 0 ? 'PAYEE' : 'PARTIELLE';

  // Catégorie financière la plus représentative des rubriques facturées.
  let categorie = 'AUTRE';
  const horsConsultation =
    facture.montantExamens + facture.montantOrdonnance + facture.montantAutres;
  const horsExamens =
    facture.montantConsultation + facture.montantOrdonnance + facture.montantAutres;
  if (horsConsultation === 0) categorie = 'CONSULTATION';
  else if (horsExamens === 0) categorie = 'ANALYSE';

  await transaction(async (client) => {
    await client.query(
      `UPDATE clinique_factures
       SET total_paye = $2, reste_a_payer = $3, statut = $4,
           mode_paiement = COALESCE($5, mode_paiement)
       WHERE id = $1`,
      [id, totalPaye, reste, statut, donnees.mode ?? null]
    );

    const serviceId = await resoudreServiceFinance(
      categorie === 'ANALYSE' ? SERVICE_FINANCE_ANALYSE : SERVICE_FINANCE_CONSULTATION,
      client
    );
    await enregistrerFlux(
      {
        serviceId,
        compteId: donnees.compteId ?? null,
        sens: 'ENTREE',
        categorie,
        mode: donnees.mode ?? 'ESPECES',
        montant,
        libelle: `Règlement facture ${facture.numero}`,
        referenceType: 'CLINIQUE_FACTURE',
        referenceId: id,
        effectuePar: utilisateur?.id ?? null,
      },
      client
    );
  });

  return obtenirFacture(id);
}

/** Annule une facture non soldée (le motif est conservé en commentaire). */
export async function annulerFacture(id, motif) {
  const facture = await exigerFacture(id);
  if (facture.statut === 'PAYEE') {
    throw ApiError.conflict('Une facture soldée ne peut pas être annulée.', 'FACTURE_SOLDEE');
  }
  if (facture.statut === 'ANNULEE') return facture;

  await query(
    `UPDATE clinique_factures
     SET statut = 'ANNULEE', commentaire = COALESCE(commentaire || E'\n', '') || $2
     WHERE id = $1`,
    [id, `[ANNULATION] ${motif}`]
  );

  return obtenirFacture(id);
}