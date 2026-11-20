// Routes des stocks de la pharmacie.
// Montage : /api/pharmacie/stocks (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { cacheReponse } from '../../../middlewares/cacheReponse.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './stocks.controller.js';
import {
  schemaCatalogue,
  schemaFiltresAlertes,
  schemaFiltresLots,
  schemaFiltresMouvements,
  schemaFiltresStock,
  schemaMouvement,
} from './stocks.schema.js';

const router = Router();

router.get('/catalogue', autoriser('pharmacie.stocks.read'), cacheReponse({ parUtilisateur: true }), valider(schemaCatalogue, 'query'), controleur.catalogue);
router.get(
  '/mouvements',
  autoriser('pharmacie.stocks.read'),
  valider(schemaFiltresMouvements, 'query'),
  controleur.listerMouvements
);
router.post('/mouvements', autoriser('pharmacie.stocks.create'), valider(schemaMouvement), controleur.creerMouvement);
router.get(
  '/valorisation',
  autoriser('pharmacie.stocks.read'),
  cacheReponse({ parUtilisateur: true }),
  valider(schemaFiltresStock, 'query'),
  controleur.valorisation
);
router.get(
  '/alertes',
  autoriser('pharmacie.stocks.read'),
  cacheReponse({ parUtilisateur: true }),
  valider(schemaFiltresAlertes, 'query'),
  controleur.alertes
);
router.get(
  '/lots',
  autoriser('pharmacie.stocks.read'),
  cacheReponse({ parUtilisateur: true }),
  valider(schemaFiltresLots, 'query'),
  controleur.lots
);

export default router;