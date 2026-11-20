// Controleur des rapports de la pharmacie.
//
// Le perimetre est applique ICI : `resoudrePointId` renvoie TOUJOURS la
// pharmacie de rattachement d'un compte cloisonne (PPV, responsable de
// pharmacie, technicien...), quelle que soit la pharmacie demandee. La
// direction (DG, DGA, Directeur technique, Comptable, Tresorier, Auditeur)
// peut demander une pharmacie precise ou l'ensemble du reseau (pointId absent).

import { succes } from '../../../utils/reponses.js';
import { resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './rapports.service.js';

/** GET /api/pharmacie/rapports/situation (indicateurs de la periode) */
export async function situation(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  const rapport = await service.situation({ ...req.valide, pointId: pointId ?? null }, req.utilisateur);
  return succes(res, rapport);
}

/**
 * GET /api/pharmacie/rapports/ventes (detail pagine de la periode)
 * Reponse : { donnees, pagination, tronque } - une page par appel, ou toute la
 * periode avec `complet=1` (PV / PDF et export CSV).
 */
export async function ventes(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  const resultat = await service.ventesSituation({ ...req.valide, pointId: pointId ?? null });
  return succes(res, resultat);
}