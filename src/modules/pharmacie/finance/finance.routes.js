// Routes du tableau de bord financier de la pharmacie.
// Montage : /api/pharmacie/finance (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { cacheReponse } from '../../../middlewares/cacheReponse.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './finance.controller.js';
import { schemaFiltresFinance } from './finance.schema.js';

const router = Router();

router.get(
  '/indicateurs',
  autoriser('pharmacie.finance.read'),
  // Indicateurs cloisonnes par pharmacie : cle de cache liee au perimetre.
  cacheReponse({ parUtilisateur: true }),
  valider(schemaFiltresFinance, 'query'),
  controleur.indicateurs
);

export default router;