
// Contrôleur Permissions (catalogue en lecture seule).

import { succes } from '../../utils/reponses.js';
import * as service from './permissions.service.js';

/** GET /api/permissions */
export async function lister(req, res) {
  const resultat = await service.listerPermissions(req.valide);
  return succes(res, resultat);
}

/** GET /api/permissions/modules */
export async function modules(_req, res) {
  const resultat = await service.listerModules();
  return succes(res, resultat);
}