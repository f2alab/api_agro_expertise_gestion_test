// Routes des referentiels produits.
// Montage : /api/pharmacie/referentiels (le routeur parent applique authentifier).

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

router.get('/', autoriser('pharmacie.produits.read'), valider(schemaFiltresReferentiels, 'query'), controleur.lister);
router.post('/', autoriser('pharmacie.produits.create'), valider(schemaCreationReferentiel), controleur.creer);

router.get('/:id', autoriser('pharmacie.produits.read'), controleur.detail);
router.patch('/:id', autoriser('pharmacie.produits.update'), valider(schemaModificationReferentiel), controleur.modifier);
router.delete('/:id', autoriser('pharmacie.produits.delete'), controleur.supprimer);

export default router;