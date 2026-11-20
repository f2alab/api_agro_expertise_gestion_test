
// Contrôleur Journal d'audit et Tableau de bord.

import { succes } from '../../utils/reponses.js';
import { listerAudit } from './audit.service.js';
import { statistiquesTableauDeBord } from '../dashboard/dashboard.service.js';

/** GET /api/journal-audit */
export async function lister(req, res) {
  const resultat = await listerAudit(req.valide);
  return succes(res, resultat);
}

/** GET /api/tableau-de-bord */
export async function tableauDeBord(_req, res) {
  const resultat = await statistiquesTableauDeBord();
  return succes(res, resultat);
}