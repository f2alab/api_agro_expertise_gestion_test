// Routes des fournisseurs de la pharmacie.
// Montage : /api/pharmacie/fournisseurs (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './fournisseurs.controller.js';
import {
  schemaCreationFournisseur,
  schemaFiltresFournisseurs,
  schemaModificationFournisseur,
} from './fournisseurs.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('pharmacie.fournisseurs.read'),
  valider(schemaFiltresFournisseurs, 'query'),
  controleur.lister
);
router.post('/', autoriser('pharmacie.fournisseurs.create'), valider(schemaCreationFournisseur), controleur.creer);

router.get('/:id', autoriser('pharmacie.fournisseurs.read'), controleur.detail);
router.patch(
  '/:id',
  autoriser('pharmacie.fournisseurs.update'),
  valider(schemaModificationFournisseur),
  controleur.modifier
);
router.delete('/:id', autoriser('pharmacie.fournisseurs.delete'), controleur.supprimer);

export default router;