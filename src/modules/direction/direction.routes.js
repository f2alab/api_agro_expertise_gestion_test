// Routes du module Direction.
// Montage : /api/direction - reserve aux profils de pilotage (DG, DGA, DT).

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { cacheReponse } from '../../middlewares/cacheReponse.js';
import { middlewarePorteeGlobale } from '../../utils/perimetre.js';
import * as controleur from './direction.controller.js';

const router = Router();

router.use(authentifier);

router.get(
  '/tableau-de-bord',
  autoriser('direction.rapports.read'),
  // Vue consolidée de TOUTES les pharmacies : réservée à la direction.
  middlewarePorteeGlobale,
  cacheReponse({ parUtilisateur: true }),
  controleur.tableauDeBord
);

export default router;