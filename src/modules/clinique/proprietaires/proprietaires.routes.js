// Routes des propriétaires d'animaux.
// Montage : /api/clinique/proprietaires (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './proprietaires.controller.js';
import {
  schemaCreationProprietaire,
  schemaFiltresProprietaires,
  schemaModificationProprietaire,
} from './proprietaires.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.proprietaires.read'),
  valider(schemaFiltresProprietaires, 'query'),
  controleur.lister
);
router.post(
  '/',
  autoriser('clinique.proprietaires.create', 'clinique.consultations.create'),
  valider(schemaCreationProprietaire),
  controleur.creer
);

router.get('/:id', autoriser('clinique.proprietaires.read'), controleur.detail);
router.patch(
  '/:id',
  autoriser('clinique.proprietaires.update'),
  valider(schemaModificationProprietaire),
  controleur.modifier
);
router.delete('/:id', autoriser('clinique.proprietaires.delete'), controleur.supprimer);

export default router;