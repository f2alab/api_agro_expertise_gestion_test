// Routes du tableau de bord de la pharmacie.
// Montage : /api/pharmacie/tableau-de-bord (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { cacheReponse } from '../../../middlewares/cacheReponse.js';
import * as controleur from './tableau-de-bord.controller.js';

const router = Router();

router.get(
  '/',
  autoriser('pharmacie.stocks.read', 'pharmacie.ventes.read'),
  // Reponse cloisonnee par pharmacie : la cle de cache inclut le perimetre.
  cacheReponse({ parUtilisateur: true }),
  controleur.tableauDeBord
);

export default router;