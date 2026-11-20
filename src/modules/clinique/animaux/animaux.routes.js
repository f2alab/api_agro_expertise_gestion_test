// Routes des fiches animaux.
// Montage : /api/clinique/animaux (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './animaux.controller.js';
import {
  schemaCreationAnimal,
  schemaFiltresAnimaux,
  schemaModificationAnimal,
} from './animaux.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.animaux.read'),
  valider(schemaFiltresAnimaux, 'query'),
  controleur.lister
);
router.post(
  '/',
  autoriser('clinique.animaux.create', 'clinique.consultations.create'),
  valider(schemaCreationAnimal),
  controleur.creer
);

// « /:id/dossier » doit être déclaré avant « /:id ».
router.get('/:id/dossier', autoriser('clinique.animaux.read'), controleur.dossier);
router.get('/:id', autoriser('clinique.animaux.read'), controleur.detail);
router.patch(
  '/:id',
  autoriser('clinique.animaux.update'),
  valider(schemaModificationAnimal),
  controleur.modifier
);
router.delete('/:id', autoriser('clinique.animaux.delete'), controleur.supprimer);

export default router;