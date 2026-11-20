// Routes du tableau de bord de la clinique.
// Montage : /api/clinique/tableau-de-bord (authentifier appliqué par le parent).

import { Router } from 'express';
import { z } from 'zod';
import { autoriser } from '../../../middlewares/autoriser.js';
import { cacheReponse } from '../../../middlewares/cacheReponse.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './tableau-de-bord.controller.js';

const schemaFiltres = z.object({
  du: z.string().trim().max(10).optional(),
  au: z.string().trim().max(10).optional(),
});

const router = Router();

router.get(
  '/',
  autoriser('clinique.rapports.read', 'clinique.consultations.read'),
  cacheReponse(),
  valider(schemaFiltres, 'query'),
  controleur.indicateurs
);

export default router;