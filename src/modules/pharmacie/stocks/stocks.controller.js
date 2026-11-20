// Controleur des stocks de la pharmacie.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './stocks.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/stocks/catalogue?pointId=... */
export async function catalogue(req, res) {
  const { recherche } = req.valide;
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerCatalogue(pointId, recherche));
}

/** GET /api/pharmacie/stocks/mouvements */
export async function listerMouvements(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerMouvements({ ...req.valide, pointId: pointId ?? undefined }));
}

/** POST /api/pharmacie/stocks/mouvements */
export async function creerMouvement(req, res) {
  const mouvement = await service.enregistrerMouvement(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'MOUVEMENT_STOCK',
    module: MODULE,
    entite: 'pharmacie_mouvement',
    entiteId: mouvement.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      typeMouvement: mouvement.typeMouvement,
      produit: mouvement.produitNom,
      quantite: mouvement.quantite,
    },
  });

  return cree(res, mouvement);
}

/** GET /api/pharmacie/stocks/valorisation */
export async function valorisation(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerStockValorise({ ...req.valide, pointId: pointId ?? undefined }));
}

/** GET /api/pharmacie/stocks/alertes */
export async function alertes(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerAlertes({ ...req.valide, pointId: pointId ?? undefined }));
}

/** GET /api/pharmacie/stocks/lots */
export async function lots(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerLots({ ...req.valide, pointId: pointId ?? undefined }));
}