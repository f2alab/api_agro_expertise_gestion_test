// Controleur du module Direction (tableau de bord consolide).

import { succes } from '../../utils/reponses.js';
import * as service from './direction.service.js';

/** GET /api/direction/tableau-de-bord */
export async function tableauDeBord(_req, res) {
  return succes(res, await service.tableauDeBordDirection());
}