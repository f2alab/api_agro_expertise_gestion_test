// Controleur des points de vente de la pharmacie.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { exigerPorteePoint, perimetreUtilisateur } from '../../../utils/perimetre.js';
import * as service from './points.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/points */
export async function lister(req, res) {
  const points = await service.listerPoints(req.valide);
  // Un compte non global ne voit que sa pharmacie de rattachement.
  const perimetre = perimetreUtilisateur(req.utilisateur);
  const donnees = perimetre.global
    ? points
    : points.filter((point) => point.id === perimetre.pointId);
  return succes(res, donnees);
}

/** GET /api/pharmacie/points/:id */
export async function detail(req, res) {
  const point = await service.exigerPoint(req.params.id);
  exigerPorteePoint(req.utilisateur, point.id);
  return succes(res, point);
}

/** POST /api/pharmacie/points */
export async function creer(req, res) {
  const point = await service.creerPoint(req.valide);

  await enregistrerAudit({
    action: 'CREATION_POINT_PHARMACIE',
    module: MODULE,
    entite: 'pharmacie_point',
    entiteId: point.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: point.code, nom: point.nom, typePoint: point.typePoint },
  });

  return cree(res, point, `/api/pharmacie/points/${point.id}`);
}

/** PATCH /api/pharmacie/points/:id */
export async function modifier(req, res) {
  const point = await service.modifierPoint(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_POINT_PHARMACIE',
    module: MODULE,
    entite: 'pharmacie_point',
    entiteId: point.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, point);
}

/** DELETE /api/pharmacie/points/:id (desactivation) */
export async function supprimer(req, res) {
  const resultat = await service.desactiverPoint(req.params.id);

  await enregistrerAudit({
    action: 'DESACTIVATION_POINT_PHARMACIE',
    module: MODULE,
    entite: 'pharmacie_point',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: resultat.code },
  });

  return succes(res, resultat);
}
