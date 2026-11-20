// Routes des référentiels du module Clinique.
// Montage : /api/clinique/referentiels (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './referentiels.controller.js';
import {
  schemaCreationReferentiel,
  schemaFiltresReferentiels,
  schemaModificationReferentiel,
} from './referentiels.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.referentiels.read', 'clinique.animaux.read'),
  valider(schemaFiltresReferentiels, 'query'),
  controleur.lister
);
router.post('/', autoriser('clinique.referentiels.create'), valider(schemaCreationReferentiel), controleur.creer);
router.patch(
  '/:id',
  autoriser('clinique.referentiels.update'),
  valider(schemaModificationReferentiel),
  controleur.modifier
);

export default router;