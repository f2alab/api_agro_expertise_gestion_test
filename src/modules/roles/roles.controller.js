
// Contrôleur Rôles.

import { cree, succes } from '../../utils/reponses.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import * as service from './roles.service.js';

/** GET /api/roles */
export async function lister(req, res) {
  const roles = await service.listerRoles(req.valide);
  return succes(res, roles);
}

/** GET /api/roles/:id */
export async function detail(req, res) {
  const role = await service.exigerRole(req.params.id);
  return succes(res, role);
}

/** POST /api/roles */
export async function creer(req, res) {
  const role = await service.creerRole(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_ROLE',
    entite: 'role',
    entiteId: role.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: role.code },
  });

  return cree(res, role, `/api/roles/${role.id}`);
}

/** PATCH /api/roles/:id */
export async function modifier(req, res) {
  const role = await service.modifierRole(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_ROLE',
    entite: 'role',
    entiteId: role.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, role);
}

/** DELETE /api/roles/:id */
export async function supprimer(req, res) {
  const resultat = await service.supprimerRole(req.params.id);

  await enregistrerAudit({
    action: 'SUPPRESSION_ROLE',
    entite: 'role',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
  });

  return succes(res, resultat);
}

/** PUT /api/roles/:id/permissions */
export async function affecterPermissions(req, res) {
  const role = await service.remplacerPermissions(req.params.id, req.valide.permissionIds);

  await enregistrerAudit({
    action: 'AFFECTATION_PERMISSIONS',
    entite: 'role',
    entiteId: role.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { nbPermissions: role.permissions.length },
  });

  return succes(res, role);
}