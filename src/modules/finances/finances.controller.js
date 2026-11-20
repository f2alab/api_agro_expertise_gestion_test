
// Contrôleur du module Finance (transversal).

import { cree, succes } from '../../utils/reponses.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import * as service from './finances.service.js';

const MODULE = 'finance';

/** GET /api/finances/services */
export async function services(req, res) {
  return succes(res, await service.listerServices(req.valide, req.utilisateur));
}

/** GET /api/finances/transactions */
export async function transactions(req, res) {
  return succes(res, await service.listerTransactions(req.valide, req.utilisateur));
}

/** POST /api/finances/transactions */
export async function creerTransaction(req, res) {
  const transaction = await service.creerTransaction(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_TRANSACTION',
    module: MODULE,
    entite: 'finance_transaction',
    entiteId: transaction.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: transaction.numero, sens: transaction.sens, montant: transaction.montant },
  });

  return cree(res, transaction, `/api/finances/transactions/${transaction.id}`);
}

/** GET /api/finances/indicateurs */
export async function indicateurs(req, res) {
  return succes(res, await service.indicateurs(req.valide, req.utilisateur));
}

/** GET /api/finances/depenses */
export async function depenses(req, res) {
  return succes(res, await service.listerDepenses(req.valide, req.utilisateur));
}

/** GET /api/finances/depenses/:id */
export async function depenseDetail(req, res) {
  return succes(res, await service.exigerDepense(req.params.id));
}

/** POST /api/finances/depenses */
export async function creerDepense(req, res) {
  const depense = await service.creerDepense(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_DEPENSE',
    module: MODULE,
    entite: 'finance_depense',
    entiteId: depense.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: depense.numero, montant: depense.montant, libelle: depense.libelle },
  });

  return cree(res, depense, `/api/finances/depenses/${depense.id}`);
}

/** POST /api/finances/depenses/:id/valider */
export async function validerDepense(req, res) {
  const depense = await service.validerDepense(req.params.id, req.valide ?? {}, req.utilisateur);

  await enregistrerAudit({
    action: 'VALIDATION_DEPENSE',
    module: MODULE,
    entite: 'finance_depense',
    entiteId: depense.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: depense.numero, montant: depense.montant, mode: depense.mode, reference: depense.reference },
  });

  return succes(res, depense);
}

/** POST /api/finances/depenses/:id/annuler */
export async function annulerDepense(req, res) {
  const depense = await service.annulerDepense(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'ANNULATION_DEPENSE',
    module: MODULE,
    entite: 'finance_depense',
    entiteId: depense.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: depense.numero, montant: depense.montant },
  });

  return succes(res, depense);
}

/** POST /api/finances/depenses/:id/rejeter */
export async function rejeterDepense(req, res) {
  const depense = await service.rejeterDepense(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'REJET_DEPENSE',
    module: MODULE,
    entite: 'finance_depense',
    entiteId: depense.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: depense.numero, montant: depense.montant },
  });

  return succes(res, depense);
}
