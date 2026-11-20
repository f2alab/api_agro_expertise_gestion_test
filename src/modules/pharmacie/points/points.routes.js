// Routes des points de vente de la pharmacie.
// Montage : /api/pharmacie/points (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './points.controller.js';
import {
  schemaCreationPoint,
  schemaFiltresPoints,
  schemaModificationPoint,
} from './points.schema.js';

const router = Router();

router.get('/', autoriser('pharmacie.points.read'), valider(schemaFiltresPoints, 'query'), controleur.lister);
router.post('/', autoriser('pharmacie.points.create'), valider(schemaCreationPoint), controleur.creer);

router.get('/:id', autoriser('pharmacie.points.read'), controleur.detail);
router.patch('/:id', autoriser('pharmacie.points.update'), valider(schemaModificationPoint), controleur.modifier);
router.delete('/:id', autoriser('pharmacie.points.delete'), controleur.supprimer);

export default router;
