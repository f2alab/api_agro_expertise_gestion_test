// Contrôleur du parcours de consultation.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './consultations.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/consultations */
export async function lister(req, res) {
  return succes(res, await service.listerConsultations(req.valide));
}

/** GET /api/clinique/consultations/veterinaires */
export async function veterinaires(_req, res) {
  return succes(res, await service.listerVeterinaires());
}

/** GET /api/clinique/consultations/file-attente */
export async function fileAttente(_req, res) {
  return succes(res, await service.fileAttente());
}

/** GET /api/clinique/consultations/:id */
export async function detail(req, res) {
  return succes(res, await service.detailConsultation(req.params.id));
}

/** POST /api/clinique/consultations/accueil */
export async function accueillir(req, res) {
  const consultation = await service.accueillir(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'ACCUEIL_CONSULTATION',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: consultation.numero,
      animal: consultation.animalCode,
      motif: consultation.motif,
      frais: consultation.fraisConsultation,
      paye: consultation.fraisPayes,
    },
  });

  return cree(res, consultation, `/api/clinique/consultations/${consultation.id}`);
}

/** POST /api/clinique/consultations/:id/paiement */
/** PATCH /api/clinique/consultations/:id (informations d'accueil) */
export async function modifier(req, res) {
  const consultation = await service.modifierConsultation(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_PASSAGE',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: consultation.numero, champs: Object.keys(req.valide) },
  });

  return succes(res, consultation);
}

/** POST /api/clinique/consultations/:id/paiement */
export async function payerFrais(req, res) {
  const consultation = await service.payerFrais(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'PAIEMENT_FRAIS_CONSULTATION',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: consultation.numero,
      montant: consultation.montantFraisPaye,
      mode: consultation.modePaiementFrais,
    },
  });

  return succes(res, consultation);
}

/** POST /api/clinique/consultations/:id/examens */
export async function enregistrerExamen(req, res) {
  const resultat = await service.enregistrerExamen(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'SAISIE_EXAMEN_CLINIQUE',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: resultat.numero,
      typeExamen: req.valide.typeExamen,
      organes: (req.valide.organes ?? []).length,
    },
  });

  return succes(res, resultat);
}

/** POST /api/clinique/consultations/:id/diagnostics */
export async function ajouterDiagnostic(req, res) {
  const diagnostic = await service.ajouterDiagnostic(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'AJOUT_DIAGNOSTIC',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { diagnostic: diagnostic.libelle, certitude: diagnostic.certitude },
  });

  return cree(res, diagnostic);
}

/** DELETE /api/clinique/consultations/:id/diagnostics/:diagnosticId */
export async function supprimerDiagnostic(req, res) {
  const resultat = await service.supprimerDiagnostic(req.params.id, req.params.diagnosticId);

  await enregistrerAudit({
    action: 'SUPPRESSION_DIAGNOSTIC',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { diagnosticId: resultat.id },
  });

  return succes(res, resultat);
}

/** POST /api/clinique/consultations/:id/statut */
export async function changerStatut(req, res) {
  const consultation = await service.changerStatut(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CHANGEMENT_STATUT_CONSULTATION',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: consultation.numero, statut: consultation.statut },
  });

  return succes(res, consultation);
}

/** POST /api/clinique/consultations/:id/cloturer */
export async function cloturer(req, res) {
  const consultation = await service.cloturer(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CLOTURE_CONSULTATION',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: consultation.numero, pronostic: consultation.pronostic },
  });

  return succes(res, consultation);
}

/** POST /api/clinique/consultations/:id/rouvrir */
export async function rouvrir(req, res) {
  const consultation = await service.rouvrirConsultation(req.params.id, req.valide.motif);

  await enregistrerAudit({
    action: 'REOUVERTURE_CONSULTATION',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: consultation.numero, motif: req.valide.motif },
  });

  return succes(res, consultation);
}

/** POST /api/clinique/consultations/:id/annuler */
export async function annuler(req, res) {
  const consultation = await service.annulerConsultation(req.params.id, req.valide.motif);

  await enregistrerAudit({
    action: 'ANNULATION_CONSULTATION',
    module: MODULE,
    entite: 'clinique_consultation',
    entiteId: consultation.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: consultation.numero, motif: req.valide.motif },
  });

  return succes(res, consultation);
}