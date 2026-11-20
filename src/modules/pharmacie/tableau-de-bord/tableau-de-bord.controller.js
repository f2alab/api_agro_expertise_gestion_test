// Controleur du tableau de bord de la pharmacie.

import { succes } from '../../../utils/reponses.js';
import { resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './tableau-de-bord.service.js';

/** GET /api/pharmacie/tableau-de-bord */
export async function tableauDeBord(req, res) {
  // Un compte rattache a une pharmacie ne voit que la sienne ; la direction
  // peut filtrer par pharmacie via ?pointId=... (sinon vue consolidée).
  const pointDemande =
    typeof req.query.pointId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.query.pointId)
      ? req.query.pointId
      : undefined;
  const pointId = resoudrePointId(req.utilisateur, pointDemande);
  return succes(res, await service.tableauDeBordPharmacie(pointId));
}