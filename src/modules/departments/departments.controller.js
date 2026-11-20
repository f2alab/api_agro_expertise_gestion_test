
// Contrôleur Départements (organigramme du groupe).

import { cree, succes } from '../../utils/reponses.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import * as service from './departments.service.js';

/** GET /api/departements */
export async function lister(req, res) {
  const resultat = await service.listerOrganigramme({
    inclureInactifs: req.valide.inclureInactifs !== 'false',
  });
  return succes(res, resultat);
}

/** GET /api/departements/:id */
export async function detail(req, res) {
  const departement = await service.exigerDepartement(req.params.id);
  return succes(res, departement);
}

/** GET /api/departements/:id/utilisateurs */
export async function utilisateurs(req, res) {
  const membres = await service.listerUtilisateursDuDepartement(req.params.id);
  return succes(res, membres);
}

/** POST /api/departements */
export async function creer(req, res) {
  const departement = await service.creerDepartement(req.valide);

  await enregistrerAudit({
    action: 'CREATION_DEPARTEMENT',
    entite: 'departement',
    entiteId: departement.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: departement.code, parentId: departement.parentId },
  });

  return cree(res, departement, `/api/departements/${departement.id}`);
}

/** PATCH /api/departements/:id */
export async function modifier(req, res) {
  const departement = await service.modifierDepartement(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_DEPARTEMENT',
    entite: 'departement',
    entiteId: departement.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, departement);
}

/** DELETE /api/departements/:id */
export async function supprimer(req, res) {
  const resultat = await service.supprimerDepartement(req.params.id);

  await enregistrerAudit({
    action: 'SUPPRESSION_DEPARTEMENT',
    entite: 'departement',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
  });

  return succes(res, resultat);
}