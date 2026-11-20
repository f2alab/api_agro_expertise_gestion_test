// Routes des echeances et engagements financiers.
// Montage : /api/finances/echeances (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './echeances.controller.js';
import {
  schemaCreationEcheance,
  schemaFiltresEcheances,
  schemaModificationEcheance,
  schemaPaiementEcheance,
  schemaRappelEcheance,
} from './echeances.schema.js';

const router = Router();

// Lecture : liste paginee, indicateurs et rappels dus (routes fixes avant /:id).
router.get(
  '/',
  autoriser('finance.echeances.read'),
  valider(schemaFiltresEcheances, 'query'),
  controleur.lister
);
router.get('/indicateurs', autoriser('finance.echeances.read'), controleur.indicateurs);
router.get('/rappels', autoriser('finance.echeances.read'), controleur.rappels);

// Ecriture
router.post('/', autoriser('finance.echeances.create'), valider(schemaCreationEcheance), controleur.creer);

router.get('/:id', autoriser('finance.echeances.read'), controleur.detail);
router.get('/:id/rappels', autoriser('finance.echeances.read'), controleur.historiqueRappels);

router.patch(
  '/:id',
  autoriser('finance.echeances.update'),
  valider(schemaModificationEcheance),
  controleur.modifier
);
router.post(
  '/:id/payer',
  autoriser('finance.echeances.validate'),
  valider(schemaPaiementEcheance),
  controleur.payer
);
router.post('/:id/annuler', autoriser('finance.echeances.validate'), controleur.annuler);
router.post(
  '/:id/rappeler',
  autoriser('finance.echeances.validate'),
  valider(schemaRappelEcheance),
  controleur.rappeler
);

export default router;