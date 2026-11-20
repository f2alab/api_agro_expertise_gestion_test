// Controleur des echeances et engagements financiers.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './echeances.service.js';

const MODULE = 'finance';

/** GET /api/finances/echeances */
export async function lister(req, res) {
  return succes(res, await service.listerEcheances(req.valide, req.utilisateur));
}

/** GET /api/finances/echeances/indicateurs */
export async function indicateurs(req, res) {
  return succes(res, await service.indicateursEcheances(req.utilisateur));
}

/** GET /api/finances/echeances/rappels (rappels dus, pour la cloche) */
export async function rappels(req, res) {
  return succes(res, await service.listerRappelsDus(req.utilisateur));
}

/** GET /api/finances/echeances/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerEcheance(req.params.id));
}

/** GET /api/finances/echeances/:id/rappels (historique) */
export async function historiqueRappels(req, res) {
  return succes(res, await service.listerRappelsEcheance(req.params.id));
}

/** POST /api/finances/echeances */
export async function creer(req, res) {
  const echeance = await service.creerEcheance(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_ECHEANCE',
    module: MODULE,
    entite: 'finance_echeance',
    entiteId: echeance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: echeance.numero,
      nature: echeance.nature,
      libelle: echeance.libelle,
      dateEcheance: echeance.dateEcheance,
    },
  });

  return cree(res, echeance, `/api/finances/echeances/${echeance.id}`);
}

/** PATCH /api/finances/echeances/:id */
export async function modifier(req, res) {
  const echeance = await service.modifierEcheance(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_ECHEANCE',
    module: MODULE,
    entite: 'finance_echeance',
    entiteId: echeance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: echeance.numero, champs: Object.keys(req.valide) },
  });

  return succes(res, echeance);
}

/** POST /api/finances/echeances/:id/payer */
export async function payer(req, res) {
  const echeance = await service.marquerEcheancePayee(
    req.params.id,
    req.valide ?? {},
    req.utilisateur
  );

  await enregistrerAudit({
    action: 'PAIEMENT_ECHEANCE',
    module: MODULE,
    entite: 'finance_echeance',
    entiteId: echeance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: echeance.numero, montant: echeance.montant },
  });

  return succes(res, echeance);
}

/** POST /api/finances/echeances/:id/annuler */
export async function annuler(req, res) {
  const echeance = await service.annulerEcheance(req.params.id);

  await enregistrerAudit({
    action: 'ANNULATION_ECHEANCE',
    module: MODULE,
    entite: 'finance_echeance',
    entiteId: echeance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: echeance.numero },
  });

  return succes(res, echeance);
}

/** POST /api/finances/echeances/:id/rappeler */
export async function rappeler(req, res) {
  const rappel = await service.enregistrerRappelEcheance(
    req.params.id,
    req.valide ?? {},
    req.utilisateur
  );

  await enregistrerAudit({
    action: 'RAPPEL_ECHEANCE',
    module: MODULE,
    entite: 'finance_echeance',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { niveau: rappel.niveau, destinataires: rappel.destinataires },
  });

  return cree(res, rappel, `/api/finances/echeances/${req.params.id}/rappels`);
}