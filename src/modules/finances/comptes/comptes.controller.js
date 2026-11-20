// Controleur des comptes de paiement (mobile money / banque).

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './comptes.service.js';

const MODULE = 'finance';

/** GET /api/finances/comptes */
export async function lister(req, res) {
  return succes(res, await service.listerComptes(req.valide));
}

/** GET /api/finances/comptes/disponibles */
export async function disponibles(req, res) {
  return succes(res, await service.listerComptesDisponibles(req.utilisateur, req.valide));
}

/** GET /api/finances/comptes/soldes */
export async function soldes(req, res) {
  return succes(res, await service.listerSoldesComptes(req.valide));
}

/** GET /api/finances/comptes/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerCompte(req.params.id));
}

/** POST /api/finances/comptes */
export async function creer(req, res) {
  const compte = await service.creerCompte(req.valide);

  await enregistrerAudit({
    action: 'CREATION_COMPTE_PAIEMENT',
    module: MODULE,
    entite: 'finance_compte',
    entiteId: compte.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { type: compte.type, prestataire: compte.prestataire, numero: compte.numero },
  });

  return cree(res, compte, `/api/finances/comptes/${compte.id}`);
}

/** PATCH /api/finances/comptes/:id */
export async function modifier(req, res) {
  const compte = await service.modifierCompte(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_COMPTE_PAIEMENT',
    module: MODULE,
    entite: 'finance_compte',
    entiteId: compte.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, compte);
}

/** DELETE /api/finances/comptes/:id (desactivation) */
export async function supprimer(req, res) {
  const resultat = await service.desactiverCompte(req.params.id);

  await enregistrerAudit({
    action: 'DESACTIVATION_COMPTE_PAIEMENT',
    module: MODULE,
    entite: 'finance_compte',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: resultat,
  });

  return succes(res, resultat);
}