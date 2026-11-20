// Controleur du tableau de bord financier de la pharmacie.

import { succes } from '../../../utils/reponses.js';
import { resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './finance.service.js';

/** GET /api/pharmacie/finance/indicateurs */
export async function indicateurs(req, res) {
  // Cloisonnement : un compte rattache a une pharmacie n'obtient que la sienne.
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.indicateurs({ ...req.valide, pointId: pointId ?? undefined }));
}