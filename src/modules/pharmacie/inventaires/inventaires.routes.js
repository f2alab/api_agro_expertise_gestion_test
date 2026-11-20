// Routes des inventaires de la pharmacie.
// Montage : /api/pharmacie/inventaires (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './inventaires.controller.js';
import {
  schemaComptage,
  schemaCreationInventaire,
  schemaFiltresInventaires,
} from './inventaires.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('pharmacie.inventaires.read'),
  valider(schemaFiltresInventaires, 'query'),
  controleur.lister
);
router.post(
  '/',
  autoriser('pharmacie.inventaires.create'),
  valider(schemaCreationInventaire),
  controleur.creer
);

router.get('/:id', autoriser('pharmacie.inventaires.read'), controleur.detail);
router.put(
  '/:id/comptage',
  autoriser('pharmacie.inventaires.create'),
  valider(schemaComptage),
  controleur.comptage
);
router.post('/:id/valider', autoriser('pharmacie.inventaires.validate'), controleur.valider);

export default router;