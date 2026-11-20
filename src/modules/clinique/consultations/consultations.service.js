// Service du parcours de consultation : accueil, frais, examens cliniques,
// diagnostics et workflow de prise en charge.

import { query, transaction } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { lirePagination, reponsePaginee } from '../../../utils/pagination.js';
import { enregistrerFlux } from '../../finances/ledger.service.js';
import {
  SERVICE_FINANCE_CONSULTATION,
  arrondi,
  exigerModifiable,
  genererNumero,
  lireFraisConsultation,
  resoudreServiceFinance,
} from '../clinique.service.js';
import { creerProprietaire, exigerProprietaire } from '../proprietaires/proprietaires.service.js';
import { creerAnimal, exigerAnimal } from '../animaux/animaux.service.js';

// Consultation + animal + propriétaire + noms des intervenants.
const SELECT_CONSULTATION = `
  SELECT c.id, c.numero, c.animal_id, c.proprietaire_id, c.motif, c.motif_referentiel_id,
         c.type_consultation, c.statut, c.frais_consultation, c.frais_payes, c.montant_frais_paye,
         c.mode_paiement_frais, c.reference_paiement, c.accueil_par, c.accueil_le,
         c.veterinaire_id, c.consultation_debut, c.consultation_fin, c.conclusion,
         c.pronostic, c.recommandations, c.cloture_le, c.notes, c.created_at, c.updated_at,
         a.code AS animal_code, a.nom AS animal_nom, a.espece, a.race, a.sexe, a.poids_kg,
         p.code AS proprietaire_code, p.nom AS proprietaire_nom,
         p.telephone AS proprietaire_telephone,
         (u.nom || ' ' || u.prenom) AS accueil_par_nom,
         (v.nom || ' ' || v.prenom) AS veterinaire_nom
  FROM clinique_consultations c
  JOIN clinique_animaux a       ON a.id = c.animal_id
  JOIN clinique_proprietaires p ON p.id = c.proprietaire_id
  LEFT JOIN utilisateurs u      ON u.id = c.accueil_par
  LEFT JOIN utilisateurs v      ON v.id = c.veterinaire_id
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserConsultation(ligne) {
  if (!ligne) return null;
  const frais = Number(ligne.frais_consultation ?? 0);
  const paye = Number(ligne.montant_frais_paye ?? 0);
  return {
    id: ligne.id,
    numero: ligne.numero,
    animalId: ligne.animal_id,
    animalCode: ligne.animal_code ?? null,
    animalNom: ligne.animal_nom ?? null,
    espece: ligne.espece ?? null,
    race: ligne.race ?? null,
    sexe: ligne.sexe ?? null,
    poidsKg: ligne.poids_kg === null || ligne.poids_kg === undefined ? null : Number(ligne.poids_kg),
    proprietaireId: ligne.proprietaire_id,
    proprietaireCode: ligne.proprietaire_code ?? null,
    proprietaireNom: ligne.proprietaire_nom ?? null,
    proprietaireTelephone: ligne.proprietaire_telephone ?? null,
    motif: ligne.motif,
    motifReferentielId: ligne.motif_referentiel_id ?? null,
    typeConsultation: ligne.type_consultation,
    statut: ligne.statut,
    fraisConsultation: frais,
    fraisPayes: Boolean(ligne.frais_payes),
    montantFraisPaye: paye,
    resteFrais: arrondi(Math.max(frais - paye, 0)),
    modePaiementFrais: ligne.mode_paiement_frais ?? null,
    referencePaiement: ligne.reference_paiement ?? null,
    accueilPar: ligne.accueil_par_nom ?? null,
    accueilLe: ligne.accueil_le,
    veterinaireId: ligne.veterinaire_id ?? null,
    veterinaireNom: ligne.veterinaire_nom ?? null,
    consultationDebut: ligne.consultation_debut ?? null,
    consultationFin: ligne.consultation_fin ?? null,
    conclusion: ligne.conclusion ?? null,
    pronostic: ligne.pronostic ?? null,
    recommandations: ligne.recommandations ?? null,
    clotureLe: ligne.cloture_le ?? null,
    notes: ligne.notes ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste paginée des consultations. */
export async function listerConsultations(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`c.statut = $${parametres.length}`);
  }
  if (filtres.animalId) {
    parametres.push(filtres.animalId);
    conditions.push(`c.animal_id = $${parametres.length}`);
  }
  if (filtres.proprietaireId) {
    parametres.push(filtres.proprietaireId);
    conditions.push(`c.proprietaire_id = $${parametres.length}`);
  }
  if (filtres.du) {
    parametres.push(filtres.du);
    conditions.push(`c.accueil_le >= $${parametres.length}::date`);
  }
  if (filtres.au) {
    parametres.push(filtres.au);
    conditions.push(`c.accueil_le < ($${parametres.length}::date + interval '1 day')`);
  }
  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(c.numero ILIKE $${i} OR a.nom ILIKE $${i} OR a.code ILIKE $${i} OR p.nom ILIKE $${i} OR c.motif ILIKE $${i})`
    );
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(
      `SELECT count(*)::int AS total
       FROM clinique_consultations c
       JOIN clinique_animaux a       ON a.id = c.animal_id
       JOIN clinique_proprietaires p ON p.id = c.proprietaire_id
       ${clause}`,
      parametres
    ),
    query(
      `${SELECT_CONSULTATION} ${clause}
       ORDER BY c.accueil_le DESC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserConsultation), compteur.rows[0].total, {
    page,
    limite,
  });
}

/** File d'attente : consultations non clôturées, du plus ancien au plus récent. */
export async function fileAttente() {
  const { rows } = await query('SELECT * FROM v_clinique_file_attente ORDER BY accueil_le ASC');
  return rows.map((ligne) => ({
    id: ligne.id,
    numero: ligne.numero,
    statut: ligne.statut,
    motif: ligne.motif,
    typeConsultation: ligne.type_consultation,
    fraisConsultation: Number(ligne.frais_consultation ?? 0),
    fraisPayes: Boolean(ligne.frais_payes),
    montantFraisPaye: Number(ligne.montant_frais_paye ?? 0),
    accueilLe: ligne.accueil_le,
    consultationDebut: ligne.consultation_debut ?? null,
    animalId: ligne.animal_id,
    animalCode: ligne.animal_code,
    animalNom: ligne.animal_nom,
    espece: ligne.espece,
    proprietaireNom: ligne.proprietaire_nom,
    proprietaireTelephone: ligne.proprietaire_telephone ?? null,
    accueilParNom: ligne.accueil_par_nom ?? null,
  }));
}

/**
 * Praticiens pouvant consulter : comptes actifs portant un rôle de consultation
 * (Direction Technique, Responsable clinique, Technicien).
 * Sert à désigner explicitement le vétérinaire d'un passage ; l'API n'expose
 * que le nom et la fonction (aucune donnée de compte).
 */
export async function listerVeterinaires() {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.nom, u.prenom, u.fonction,
            bool_or(r.code IN ('VETERINAIRE', 'DIR_TECHNIQUE', 'RESP_CLINIQUE'))
              AS est_docteur
     FROM utilisateurs u
     JOIN utilisateurs_roles ur ON ur.utilisateur_id = u.id
     JOIN roles r               ON r.id = ur.role_id
     WHERE u.statut = 'ACTIF' AND r.actif = TRUE
       AND r.code IN ('DIR_TECHNIQUE', 'RESP_CLINIQUE', 'VETERINAIRE',
                      'ASSISTANT_VETERINAIRE', 'TECHNICIEN')
     GROUP BY u.id, u.nom, u.prenom, u.fonction
     ORDER BY u.nom, u.prenom`
  );

  // Praticiens de la clinique : agent d'accueil exclu, les autres profils
  // cliniques (Docteur vétérinaire, Assistant, Responsable, Technicien) sont
  // proposés comme vétérinaire du passage.
  const praticiens = rows.map((ligne) => ({
    id: ligne.id,
    nomComplet: `${ligne.nom} ${ligne.prenom}`.trim(),
    fonction: ligne.fonction ?? null,
    estDocteur: ligne.est_docteur ?? false,
  }));

  return praticiens;
}

/**
 * Récupère une consultation ou null.
 */
export async function obtenirConsultation(id) {
  const { rows } = await query(`${SELECT_CONSULTATION} WHERE c.id = $1`, [id]);
  return rows[0] ? serialiserConsultation(rows[0]) : null;
}

/** Récupère une consultation ou lève une 404. */
export async function exigerConsultation(id) {
  const consultation = await obtenirConsultation(id);
  if (!consultation) {
    throw ApiError.notFound('Consultation introuvable.', 'CONSULTATION_INTROUVABLE');
  }
  return consultation;
}

/** Résout le propriétaire : fiche existante ou création à l'accueil. */
async function resoudreProprietaire(donnees, utilisateur) {
  if (donnees.proprietaireId) return exigerProprietaire(donnees.proprietaireId);
  if (donnees.proprietaire) return creerProprietaire(donnees.proprietaire, utilisateur);
  throw ApiError.badRequest(
    'Un propriétaire est requis (existant ou à créer).',
    'PROPRIETAIRE_REQUIS'
  );
}

/** Résout l'animal : fiche existante (même propriétaire) ou création. */
async function resoudreAnimal(donnees, proprietaire, utilisateur) {
  if (donnees.animalId) {
    const animal = await exigerAnimal(donnees.animalId);
    if (animal.proprietaireId !== proprietaire.id) {
      throw ApiError.conflict(
        "Cet animal n'appartient pas au propriétaire indiqué.",
        'ANIMAL_AUTRE_PROPRIETAIRE'
      );
    }
    return animal;
  }
  if (donnees.animal) {
    return creerAnimal({ ...donnees.animal, proprietaireId: proprietaire.id }, utilisateur);
  }
  throw ApiError.badRequest("Un animal est requis (existant ou à créer).", 'ANIMAL_REQUIS');
}

/**
 * Enregistrement à l'accueil : animal + propriétaire + motif, puis encaissement
 * des frais de consultation (montant lu dans les paramètres, figé sur la fiche).
 */
export async function accueillir(donnees, utilisateur = null) {
  const proprietaire = await resoudreProprietaire(donnees, utilisateur);
  const animal = await resoudreAnimal(donnees, proprietaire, utilisateur);

  const frais = await lireFraisConsultation();
  const numero = await genererNumero('CONS');

  const paiement = donnees.paiement ?? {};
  const paye = Boolean(paiement.paye);
  const montantPaye = paye ? arrondi(paiement.montant ?? frais) : 0;
  if (montantPaye > frais) {
    throw ApiError.badRequest(
      'Le montant encaissé dépasse les frais de consultation.',
      'MONTANT_SUPERIEUR',
      { frais, montant: montantPaye }
    );
  }

  const statut = paye ? 'EN_CONSULTATION' : 'EN_ATTENTE_PAIEMENT';

  const consultationId = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO clinique_consultations
         (numero, animal_id, proprietaire_id, motif, motif_referentiel_id, type_consultation,
          statut, frais_consultation, frais_payes, montant_frais_paye, mode_paiement_frais,
          reference_paiement, accueil_par, veterinaire_id, consultation_debut, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        numero,
        animal.id,
        proprietaire.id,
        donnees.motif.trim(),
        donnees.motifReferentielId ?? null,
        donnees.typeConsultation ?? 'CONSULTATION',
        statut,
        frais,
        paye,
        montantPaye,
        paye ? paiement.mode ?? 'ESPECES' : null,
        paye ? paiement.reference ?? null : null,
        utilisateur?.id ?? null,
        donnees.veterinaireId ?? null,
        paye ? new Date() : null,
        donnees.notes ?? null,
      ]
    );
    const id = rows[0].id;

    if (paye && montantPaye > 0) {
      const serviceId = await resoudreServiceFinance(SERVICE_FINANCE_CONSULTATION, client);
      await enregistrerFlux(
        {
          serviceId,
          compteId: paiement.compteId ?? null,
          sens: 'ENTREE',
          categorie: 'CONSULTATION',
          mode: paiement.mode ?? 'ESPECES',
          montant: montantPaye,
          libelle: `Frais de consultation ${numero}`,
          referenceType: 'CONSULTATION_CLINIQUE',
          referenceId: id,
          effectuePar: utilisateur?.id ?? null,
        },
        client
      );
    }

    return id;
  });

  return detailConsultation(consultationId);
}

/** Encaisse les frais de consultation d'un passage encore impayé. */
export async function payerFrais(id, donnees, utilisateur = null) {
  const consultation = await exigerConsultation(id);

  if (consultation.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette consultation est annulée.', 'CONSULTATION_ANNULEE');
  }
  if (consultation.fraisPayes) {
    throw ApiError.conflict(
      'Les frais de consultation sont déjà réglés.',
      'FRAIS_DEJA_PAYES',
      { montantPaye: consultation.montantFraisPaye }
    );
  }

  const montant = arrondi(donnees.montant ?? consultation.fraisConsultation);
  if (montant <= 0) {
    throw ApiError.badRequest('Le montant encaissé est invalide.', 'MONTANT_INVALIDE');
  }
  if (montant > consultation.fraisConsultation) {
    throw ApiError.badRequest(
      'Le montant encaissé dépasse les frais de consultation.',
      'MONTANT_SUPERIEUR',
      { frais: consultation.fraisConsultation, montant }
    );
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE clinique_consultations
       SET frais_payes = TRUE, montant_frais_paye = $2, mode_paiement_frais = $3,
           reference_paiement = $4,
           statut = CASE WHEN statut = 'EN_ATTENTE_PAIEMENT' THEN 'EN_CONSULTATION' ELSE statut END,
           consultation_debut = COALESCE(consultation_debut, now())
       WHERE id = $1`,
      [id, montant, donnees.mode ?? 'ESPECES', donnees.reference ?? null]
    );

    const serviceId = await resoudreServiceFinance(SERVICE_FINANCE_CONSULTATION, client);
    await enregistrerFlux(
      {
        serviceId,
        compteId: donnees.compteId ?? null,
        sens: 'ENTREE',
        categorie: 'CONSULTATION',
        mode: donnees.mode ?? 'ESPECES',
        montant,
        libelle: `Frais de consultation ${consultation.numero}`,
        referenceType: 'CONSULTATION_CLINIQUE',
        referenceId: id,
        effectuePar: utilisateur?.id ?? null,
      },
      client
    );
  });

  return detailConsultation(id);
}

/** Transforme une ligne d'examen clinique en objet API. */
function serialiserExamen(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    typeExamen: ligne.type_examen,
    etatGeneral: ligne.etat_general ?? null,
    comportement: ligne.comportement ?? null,
    attitude: ligne.attitude ?? null,
    embonpoint: ligne.embonpoint ?? null,
    signesExterieurs: ligne.signes_exterieurs ?? null,
    temperatureC: ligne.temperature_c === null ? null : Number(ligne.temperature_c),
    frequenceCardiaque: ligne.frequence_cardiaque ?? null,
    frequenceRespiratoire: ligne.frequence_respiratoire ?? null,
    pulsation: ligne.pulsation ?? null,
    tempsRecolorationCapillaireS:
      ligne.temps_recoloration_capillaire_s === null
        ? null
        : Number(ligne.temps_recoloration_capillaire_s),
    muqueuses: ligne.muqueuses ?? null,
    pliCutane: ligne.pli_cutane ?? null,
    hydratation: ligne.hydratation ?? null,
    etatNutrition: ligne.etat_nutrition ?? null,
    scoreDouleur: ligne.score_douleur ?? null,
    lymphonoeuds: ligne.lymphonoeuds ?? null,
    notes: ligne.notes ?? null,
    examineLe: ligne.examine_le,
  };
}

/** Examens cliniques d'une consultation (à distance + rapproché) et organes. */
export async function listerExamens(consultationId) {
  const { rows } = await query(
    `SELECT * FROM clinique_examens WHERE consultation_id = $1 ORDER BY type_examen`,
    [consultationId]
  );

  const examens = rows.map(serialiserExamen);
  const rapproche = examens.find((examen) => examen.typeExamen === 'RAPPROCHE') ?? null;

  let organes = [];
  if (rapproche) {
    const resultat = await query(
      `SELECT organe, etat, observation FROM clinique_examens_organes
       WHERE examen_id = $1 ORDER BY organe`,
      [rapproche.id]
    );
    organes = resultat.rows.map((ligne) => ({
      organe: ligne.organe,
      etat: ligne.etat,
      observation: ligne.observation ?? null,
    }));
  }

  return {
    distance: examens.find((examen) => examen.typeExamen === 'DISTANCE') ?? null,
    rapproche,
    organes,
  };
}

/**
 * Saisit ou met à jour un examen clinique.
 * Le paiement des frais de consultation conditionne l'accès à la salle de
 * consultation : l'examen est refusé tant que les frais ne sont pas réglés.
 */
export async function enregistrerExamen(consultationId, donnees, utilisateur = null) {
  const consultation = await exigerConsultation(consultationId);
  exigerModifiable(consultation, "modifier l'examen clinique");

  if (!consultation.fraisPayes) {
    throw ApiError.conflict(
      'Les frais de consultation doivent être réglés avant de commencer l\'examen.',
      'FRAIS_NON_PAYES',
      { frais: consultation.fraisConsultation, reste: consultation.resteFrais }
    );
  }

  const examenId = await transaction(async (client) => {
    // Remplacement complet de l'examen : simple et sans conflit d'unicité.
    await client.query(
      'DELETE FROM clinique_examens WHERE consultation_id = $1 AND type_examen = $2',
      [consultationId, donnees.typeExamen]
    );

    const { rows } = await client.query(
      `INSERT INTO clinique_examens
         (consultation_id, type_examen, etat_general, comportement, attitude, embonpoint,
          signes_exterieurs, temperature_c, frequence_cardiaque, frequence_respiratoire,
          pulsation, temps_recoloration_capillaire_s, muqueuses, pli_cutane, hydratation,
          etat_nutrition, score_douleur, lymphonoeuds, notes, examine_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        consultationId,
        donnees.typeExamen,
        donnees.etatGeneral ?? null,
        donnees.comportement ?? null,
        donnees.attitude ?? null,
        donnees.embonpoint ?? null,
        donnees.signesExterieurs ?? null,
        donnees.temperatureC ?? null,
        donnees.frequenceCardiaque ?? null,
        donnees.frequenceRespiratoire ?? null,
        donnees.pulsation ?? null,
        donnees.tempsRecolorationCapillaireS ?? null,
        donnees.muqueuses ?? null,
        donnees.pliCutane ?? null,
        donnees.hydratation ?? null,
        donnees.etatNutrition ?? null,
        donnees.scoreDouleur ?? null,
        donnees.lymphonoeuds ?? null,
        donnees.notes ?? null,
        utilisateur?.id ?? null,
      ]
    );
    const id = rows[0].id;

    for (const organe of donnees.organes ?? []) {
      await client.query(
        `INSERT INTO clinique_examens_organes (examen_id, organe, etat, observation)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (examen_id, organe) DO UPDATE
           SET etat = EXCLUDED.etat, observation = EXCLUDED.observation`,
        [id, organe.organe, organe.etat ?? 'NON_EXAMINE', organe.observation ?? null]
      );
    }

    // L'examen marque l'entrée effective en salle de consultation.
    await client.query(
      `UPDATE clinique_consultations
       SET statut = CASE WHEN statut IN ('ACCUEIL','EN_ATTENTE_PAIEMENT') THEN 'EN_CONSULTATION' ELSE statut END,
           consultation_debut = COALESCE(consultation_debut, now()),
           veterinaire_id = COALESCE($2, veterinaire_id)
       WHERE id = $1`,
      [consultationId, utilisateur?.id ?? null]
    );

    return id;
  });

  return { examenId, ...(await detailConsultation(consultationId)) };
}

/** Diagnostics posés sur une consultation. */
export async function listerDiagnostics(consultationId) {
  const { rows } = await query(
    `SELECT d.id, d.libelle, d.codification, d.certitude, d.gravite, d.commentaire, d.cree_le,
            (u.nom || ' ' || u.prenom) AS pose_par_nom
     FROM clinique_diagnostics d
     LEFT JOIN utilisateurs u ON u.id = d.pose_par
     WHERE d.consultation_id = $1
     ORDER BY d.cree_le`,
    [consultationId]
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    libelle: ligne.libelle,
    codification: ligne.codification ?? null,
    certitude: ligne.certitude,
    gravite: ligne.gravite ?? null,
    commentaire: ligne.commentaire ?? null,
    poseParNom: ligne.pose_par_nom ?? null,
    creeLe: ligne.cree_le,
  }));
}

/** Ajoute un diagnostic (présomptif, confirmé ou différentiel). */
export async function ajouterDiagnostic(consultationId, donnees, utilisateur = null) {
  const consultation = await exigerConsultation(consultationId);
  exigerModifiable(consultation, 'ajouter un diagnostic');

  const { rows } = await query(
    `INSERT INTO clinique_diagnostics
       (consultation_id, libelle, codification, certitude, gravite, commentaire, pose_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, libelle, codification, certitude, gravite, commentaire, cree_le`,
    [
      consultationId,
      donnees.libelle.trim(),
      donnees.codification ?? null,
      donnees.certitude ?? 'PRESOMPTIF',
      donnees.gravite ?? null,
      donnees.commentaire ?? null,
      utilisateur?.id ?? null,
    ]
  );

  const ligne = rows[0];
  return {
    id: ligne.id,
    libelle: ligne.libelle,
    codification: ligne.codification ?? null,
    certitude: ligne.certitude,
    gravite: ligne.gravite ?? null,
    commentaire: ligne.commentaire ?? null,
    poseParNom: utilisateur ? `${utilisateur.nom ?? ''} ${utilisateur.prenom ?? ''}`.trim() : null,
    creeLe: ligne.cree_le,
  };
}

/** Retire un diagnostic saisi par erreur. */
export async function supprimerDiagnostic(consultationId, diagnosticId) {
  const consultation = await exigerConsultation(consultationId);
  exigerModifiable(consultation, 'supprimer un diagnostic');

  const { rowCount } = await query(
    'DELETE FROM clinique_diagnostics WHERE id = $1 AND consultation_id = $2',
    [diagnosticId, consultationId]
  );
  if (!rowCount) {
    throw ApiError.notFound('Diagnostic introuvable.', 'DIAGNOSTIC_INTROUVABLE');
  }
  return { id: diagnosticId };
}

/** Modifie les informations d'accueil d'une consultation (motif, type, notes). */
export async function modifierConsultation(id, donnees) {
  const consultation = await exigerConsultation(id);
  exigerModifiable(consultation, 'modifier le passage');

  const champs = [];
  const valeurs = [];
  const ajouter = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.motif !== undefined) ajouter('motif', donnees.motif.trim());
  if (donnees.motifReferentielId !== undefined) {
    ajouter('motif_referentiel_id', donnees.motifReferentielId);
  }
  if (donnees.typeConsultation !== undefined) ajouter('type_consultation', donnees.typeConsultation);
  // Praticien qui consulte : peut être désigné (ou corrigé) explicitement.
  if (donnees.veterinaireId !== undefined) ajouter('veterinaire_id', donnees.veterinaireId);
  if (donnees.notes !== undefined) ajouter('notes', donnees.notes);

  if (champs.length === 0) return consultation;

  valeurs.push(id);
  await query(
    `UPDATE clinique_consultations SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
    valeurs
  );

  return obtenirConsultation(id);
}

/** Change l'étape du parcours (salle de consultation, paraclinique, résultats...). */
export async function changerStatut(consultationId, donnees, utilisateur = null) {
  const consultation = await exigerConsultation(consultationId);

  if (consultation.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette consultation est annulée.', 'CONSULTATION_ANNULEE');
  }
  // Un dossier clôturé ne se « dé-clôture » pas en changeant d'étape : la
  // reprise passe par une réouverture explicite (`rouvrirConsultation`).
  if (consultation.statut === 'CLOTURE') {
    throw ApiError.conflict(
      'Ce dossier est clôturé : rouvrez la consultation pour la modifier.',
      'CONSULTATION_CLOTUREE',
      { statut: consultation.statut }
    );
  }
  if (!consultation.fraisPayes) {
    throw ApiError.conflict(
      'Les frais de consultation doivent être réglés avant de poursuivre.',
      'FRAIS_NON_PAYES',
      { frais: consultation.fraisConsultation, reste: consultation.resteFrais }
    );
  }

  await query(
    // `$2` est utilisé deux fois : en affectation de la colonne `statut`
    // (VARCHAR) et dans une comparaison. Sans cast explicite, PostgreSQL déduit
    // `varchar` pour l'affectation mais `text` pour la comparaison (le littéral
    // non typé est résolu en `text`), d'où l'erreur 42P08 « types incohérents
    // déduits pour le paramètre $2 ». Le cast `::varchar` fixe le type du
    // paramètre une fois pour toutes.
    `UPDATE clinique_consultations
     SET statut = $2::varchar,
         consultation_debut = CASE WHEN $2::varchar = 'EN_CONSULTATION'
                                   THEN COALESCE(consultation_debut, now())
                                   ELSE consultation_debut END,
         veterinaire_id = COALESCE($3::uuid, veterinaire_id)
     WHERE id = $1`,
    [consultationId, donnees.statut, donnees.veterinaireId ?? utilisateur?.id ?? null]
  );

  return detailConsultation(consultationId);
}

/**
 * Clôture la consultation : conclusion, pronostic et recommandations.
 * Le dossier médical ne peut être clos sans diagnostic ni conclusion.
 */
export async function cloturer(consultationId, donnees, utilisateur = null) {
  const consultation = await exigerConsultation(consultationId);

  if (consultation.statut === 'CLOTURE') {
    throw ApiError.conflict('Cette consultation est déjà clôturée.', 'DEJA_CLOTUREE');
  }
  if (consultation.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette consultation est annulée.', 'CONSULTATION_ANNULEE');
  }

  const diagnostics = await listerDiagnostics(consultationId);
  if (!donnees.conclusion && diagnostics.length === 0) {
    throw ApiError.badRequest(
      'Renseignez au moins un diagnostic ou une conclusion avant de clôturer.',
      'CONCLUSION_REQUISE'
    );
  }

  await query(
    `UPDATE clinique_consultations
     SET statut = 'CLOTURE', conclusion = COALESCE($2, conclusion),
         pronostic = COALESCE($3, pronostic), recommandations = COALESCE($4, recommandations),
         cloture_par = $5, cloture_le = now(), consultation_fin = now()
     WHERE id = $1`,
    [
      consultationId,
      donnees.conclusion ?? null,
      donnees.pronostic ?? null,
      donnees.recommandations ?? null,
      utilisateur?.id ?? null,
    ]
  );

  return detailConsultation(consultationId);
}

/**
 * Rouvre une consultation clôturée : opération explicite et tracée.
 *
 * Le dossier médical est conservé intégralement (aucune donnée n'est effacée) :
 * seule la clôture est annulée (`cloture_par` / `cloture_le` remis à NULL) et la
 * date de fin de consultation est libérée. Le motif de réouverture est ajouté
 * aux notes, qui servent d'historique du dossier.
 */
export async function rouvrirConsultation(consultationId, motif) {
  const consultation = await exigerConsultation(consultationId);

  if (consultation.statut === 'ANNULEE') {
    throw ApiError.conflict('Cette consultation est annulée.', 'CONSULTATION_ANNULEE');
  }
  if (consultation.statut !== 'CLOTURE') {
    throw ApiError.conflict(
      'Seule une consultation clôturée peut être rouverte.',
      'CONSULTATION_NON_CLOTUREE',
      { statut: consultation.statut }
    );
  }

  await query(
    `UPDATE clinique_consultations
     SET statut = 'EN_CONSULTATION', cloture_par = NULL, cloture_le = NULL,
         consultation_fin = NULL,
         notes = COALESCE(notes || E'\n', '') || $2
     WHERE id = $1`,
    [consultationId, `[REOUVERTURE] ${motif}`]
  );

  return detailConsultation(consultationId);
}

/** Annule une consultation non clôturée (motif conservé dans les notes). */
export async function annulerConsultation(consultationId, motif) {
  const consultation = await exigerConsultation(consultationId);

  if (consultation.statut === 'CLOTURE') {
    throw ApiError.conflict(
      'Une consultation clôturée ne peut plus être annulée.',
      'CONSULTATION_CLOTUREE'
    );
  }
  if (consultation.statut === 'ANNULEE') {
    return obtenirConsultation(consultationId);
  }

  await query(
    `UPDATE clinique_consultations
     SET statut = 'ANNULEE', notes = COALESCE(notes || E'\n', '') || $2
     WHERE id = $1`,
    [consultationId, `[ANNULATION] ${motif}`]
  );

  return obtenirConsultation(consultationId);
}

/**
 * Détail complet d'une consultation : examens cliniques (distance et
 * rapproché), diagnostics, examens paracliniques, ordonnances et factures.
 * C'est la vue de travail de la salle de consultation.
 */
export async function detailConsultation(id) {
  const consultation = await exigerConsultation(id);

  const [examens, diagnostics, paracliniques, ordonnances, factures] = await Promise.all([
    listerExamens(id),
    listerDiagnostics(id),
    query(
      `SELECT id, numero, type_examen, libelle, indication, statut, montant, paye,
              resultat, conclusion, demande_le, resultat_le
       FROM clinique_examens_paracliniques
       WHERE consultation_id = $1
       ORDER BY demande_le`,
      [id]
    ),
    query(
      `SELECT o.id, o.numero, o.statut, o.point_id, po.nom AS point_nom, o.created_at,
              o.approuve_le,
              (em.nom || ' ' || em.prenom) AS emis_par_nom,
              (ap.nom || ' ' || ap.prenom) AS approuve_par_nom,
              (SELECT count(*)::int FROM clinique_ordonnances_lignes l
                WHERE l.ordonnance_id = o.id) AS nb_lignes,
              (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0)
                 FROM clinique_ordonnances_lignes l WHERE l.ordonnance_id = o.id) AS montant
       FROM clinique_ordonnances o
       LEFT JOIN pharmacie_points po ON po.id = o.point_id
       LEFT JOIN utilisateurs em     ON em.id = o.emis_par
       LEFT JOIN utilisateurs ap     ON ap.id = o.approuve_par
       WHERE o.consultation_id = $1
       ORDER BY o.created_at DESC`,
      [id]
    ),
    query(
      `SELECT id, numero, statut, montant_total, total_paye, reste_a_payer, date_facture
       FROM clinique_factures
       WHERE consultation_id = $1
       ORDER BY date_facture DESC`,
      [id]
    ),
  ]);

  // Lignes des ordonnances : la fiche de consultation affiche les produits
  // prescrits (même logique que le détail produit d'une facture).
  const ordonnanceIds = ordonnances.rows.map((ligne) => ligne.id);
  const lignesParOrdonnance = new Map();
  if (ordonnanceIds.length > 0) {
    const detail = await query(
      `SELECT id, ordonnance_id, designation, posologie, voie, duree_jours, quantite, prix_unitaire
       FROM clinique_ordonnances_lignes
       WHERE ordonnance_id = ANY($1::uuid[])
       ORDER BY ordre, created_at`,
      [ordonnanceIds]
    );

    for (const ligne of detail.rows) {
      const liste = lignesParOrdonnance.get(ligne.ordonnance_id) ?? [];
      liste.push({
        id: ligne.id,
        designation: ligne.designation,
        posologie: ligne.posologie ?? null,
        voie: ligne.voie ?? null,
        dureeJours: ligne.duree_jours ?? null,
        quantite: Number(ligne.quantite ?? 0),
        prixUnitaire: Number(ligne.prix_unitaire ?? 0),
        montant: arrondi(Number(ligne.quantite ?? 0) * Number(ligne.prix_unitaire ?? 0)),
      });
      lignesParOrdonnance.set(ligne.ordonnance_id, liste);
    }
  }

  return {
    ...consultation,
    examens,
    diagnostics,
    paracliniques: paracliniques.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      typeExamen: ligne.type_examen,
      libelle: ligne.libelle,
      indication: ligne.indication ?? null,
      statut: ligne.statut,
      montant: Number(ligne.montant ?? 0),
      paye: Boolean(ligne.paye),
      resultat: ligne.resultat ?? null,
      conclusion: ligne.conclusion ?? null,
      demandeLe: ligne.demande_le,
      resultatLe: ligne.resultat_le ?? null,
    })),
    ordonnances: ordonnances.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      statut: ligne.statut,
      pointId: ligne.point_id ?? null,
      pointNom: ligne.point_nom ?? null,
      emiseLe: ligne.created_at,
      nbLignes: ligne.nb_lignes ?? 0,
      montant: Number(ligne.montant ?? 0),
      // Traçabilité de la prescription : proposée par le consultant, approuvée
      // (ou non) par le Docteur vétérinaire.
      emisParNom: ligne.emis_par_nom ?? null,
      approuveParNom: ligne.approuve_par_nom ?? null,
      approuveLe: ligne.approuve_le ?? null,
      // Produits prescrits (détail affiché dans la fiche de consultation).
      lignes: lignesParOrdonnance.get(ligne.id) ?? [],
    })),
    factures: factures.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      statut: ligne.statut,
      montantTotal: Number(ligne.montant_total ?? 0),
      totalPaye: Number(ligne.total_paye ?? 0),
      resteAPayer: Number(ligne.reste_a_payer ?? 0),
      dateFacture: ligne.date_facture,
    })),
  };
}