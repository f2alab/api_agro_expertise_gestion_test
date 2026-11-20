// Schémas de validation du parcours de consultation.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Modes de paiement acceptes au guichet de la clinique. */
export const MODES_PAIEMENT_CLINIQUE = ['ESPECES', 'MOBILE_MONEY', 'CARTE', 'CHEQUE', 'VIREMENT'];

/** Types de consultation proposes a l'accueil. */
export const TYPES_CONSULTATION = ['CONSULTATION', 'URGENCE', 'CONTROLE', 'VACCINATION', 'CHIRURGIE', 'SUIVI'];

/** Nombre optionnel : un champ vide ou nul n'est pas converti en 0. */
const nombre = (min, max) =>
  z.preprocess(
    (valeur) => (valeur === '' || valeur === null || valeur === undefined ? undefined : valeur),
    z.coerce.number().min(min).max(max).optional().nullable()
  );

/** Entier optionnel (meme regle que `nombre`). */
const entier = (min, max) =>
  z.preprocess(
    (valeur) => (valeur === '' || valeur === null || valeur === undefined ? undefined : valeur),
    z.coerce.number().int().min(min).max(max).optional().nullable()
  );

/** Texte libre optionnel. */
const texte = (max) => z.string().trim().max(max).optional().nullable();

/** Choix optionnel dans une liste fermee. */
const choix = (valeurs) => z.enum(valeurs).optional().nullable();

/** Paiement des frais de consultation a l'accueil. */
export const schemaPaiementFrais = z.object({
  paye: z.boolean().optional(),
  montant: nombre(0, 10_000_000),
  mode: z.enum(MODES_PAIEMENT_CLINIQUE).optional(),
  reference: texte(80),
  compteId: uuid.optional().nullable(),
});

/** Proprietaire cree directement a l'accueil (si non encore enregistre). */
const schemaProprietaireAccueil = z.object({
  nom: z.string().trim().min(2, 'Le nom du proprietaire est requis.').max(150),
  telephone: texte(30),
  telephoneSecondaire: texte(30),
  email: z.preprocess(
    (valeur) => (typeof valeur === 'string' && valeur.trim() === '' ? null : valeur),
    z.string().email('Adresse e-mail invalide.').max(180).optional().nullable()
  ),
  adresse: texte(200),
  ville: texte(120),
  typeProprietaire: choix(['PARTICULIER', 'ELEVEUR', 'ENTREPRISE', 'ETAT', 'ONG', 'AUTRE']),
});

/** Animal cree directement a l'accueil (si non encore enregistre). */
const schemaAnimalAccueil = z.object({
  nom: texte(120),
  espece: z.string().trim().min(2, "L'espece est requise.").max(80),
  race: texte(80),
  sexe: z.enum(['M', 'F', 'INCONNU']).optional(),
  dateNaissance: texte(10),
  ageEstime: texte(40),
  poidsKg: nombre(0, 20_000),
  robe: texte(80),
  identification: texte(120),
  signesParticuliers: texte(2000),
});

/** Enregistrement a l'accueil : animal existant ou nouveau, proprietaire existant ou nouveau. */
export const schemaAccueil = z.object({
  proprietaireId: uuid.optional().nullable(),
  proprietaire: schemaProprietaireAccueil.optional().nullable(),
  animalId: uuid.optional().nullable(),
  animal: schemaAnimalAccueil.optional().nullable(),
  motif: z.string().trim().min(3, 'Le motif de consultation est requis.').max(300),
  motifReferentielId: uuid.optional().nullable(),
  typeConsultation: z.enum(TYPES_CONSULTATION).optional(),
  veterinaireId: uuid.optional().nullable(),
  paiement: schemaPaiementFrais.optional().nullable(),
  notes: texte(2000),
});

/** Saisie / mise a jour d'un examen clinique (constantes et organes). */
export const schemaExamen = z.object({
  typeExamen: z.enum(['DISTANCE', 'RAPPROCHE']),
  // Examen a distance
  etatGeneral: choix(['BON', 'MOYEN', 'MAUVAIS', 'CRITIQUE']),
  comportement: texte(40),
  attitude: texte(40),
  embonpoint: entier(1, 5),
  signesExterieurs: texte(2000),
  // Examen rapproche (constantes)
  temperatureC: nombre(0, 60),
  frequenceCardiaque: entier(0, 500),
  frequenceRespiratoire: entier(0, 300),
  pulsation: texte(60),
  tempsRecolorationCapillaireS: nombre(0, 60),
  muqueuses: texte(40),
  pliCutane: texte(20),
  hydratation: texte(20),
  etatNutrition: texte(20),
  scoreDouleur: entier(0, 5),
  lymphonoeuds: texte(80),
  notes: texte(4000),
  organes: z
    .array(
      z.object({
        organe: z.string().trim().min(2).max(80),
        etat: z.enum(['NORMAL', 'ANORMAL', 'NON_EXAMINE']).optional(),
        observation: texte(1000),
      })
    )
    .max(50)
    .optional(),
});

/** Diagnostic pose a l'issue de l'examen clinique. */
export const schemaDiagnostic = z.object({
  libelle: z.string().trim().min(2, 'Le libelle du diagnostic est requis.').max(200),
  codification: texte(40),
  certitude: z.enum(['CONFIRME', 'PRESOMPTIF', 'DIFFERENTIEL', 'INFIRME']).optional(),
  gravite: choix(['FAIBLE', 'MODEREE', 'SEVERE', 'CRITIQUE']),
  commentaire: texte(2000),
});

/** Changement d'etape du parcours (salle de consultation, paraclinique...). */
export const schemaChangementStatut = z.object({
  statut: z.enum(['EN_ATTENTE_PAIEMENT', 'EN_CONSULTATION', 'EXAMEN_PARACLINIQUE', 'RESULTATS', 'ORDONNANCE']),
  veterinaireId: uuid.optional().nullable(),
});

/** Cloture de la consultation (conclusion et conseils). */
export const schemaCloture = z.object({
  conclusion: texte(4000),
  pronostic: choix(['FAVORABLE', 'RESERVE', 'DEFAVORABLE']),
  recommandations: texte(4000),
});

/** Annulation d'une consultation (motif obligatoire, trace). */
export const schemaAnnulationConsultation = z.object({
  motif: z.string().trim().min(3, 'Le motif est requis.').max(300),
});

/**
 * Modification des informations d'accueil d'un passage.
 * Le tarif de consultation n'est pas modifiable : il est figé sur la fiche.
 */
export const schemaModificationConsultation = z.object({
  motif: z.string().trim().min(3, 'Le motif de consultation est requis.').max(300).optional(),
  motifReferentielId: uuid.optional().nullable(),
  typeConsultation: z.enum(TYPES_CONSULTATION).optional(),
  /** Praticien qui consulte (peut être désigné ou corrigé). */
  veterinaireId: uuid.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** Filtres de la liste des consultations. */
/**
 * Réouverture d'une consultation clôturée : opération explicite et tracée,
 * réservée aux profils habilités à valider une consultation.
 */
export const schemaReouvertureConsultation = z.object({
  motif: z.string().trim().min(3, 'Le motif de réouverture est requis.').max(300),
});

export const schemaFiltresConsultations = z.object({
  statut: choix([
    'ACCUEIL', 'EN_ATTENTE_PAIEMENT', 'EN_CONSULTATION', 'EXAMEN_PARACLINIQUE',
    'RESULTATS', 'ORDONNANCE', 'CLOTURE', 'ANNULEE',
  ]),
  animalId: uuid.optional(),
  proprietaireId: uuid.optional(),
  recherche: z.string().trim().max(120).optional(),
  du: z.string().trim().max(10).optional(),
  au: z.string().trim().max(10).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
});