// Routes des clients de la pharmacie.
// Montage : /api/pharmacie/clients (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './clients.controller.js';
import {
  schemaCreationClient,
  schemaFiltresClients,
  schemaFiltresCreances,
  schemaModificationClient,
  schemaTopClients,
} from './clients.schema.js';

const router = Router();

// « /top » et « /creances » doivent etre declares avant « /:id ».
router.get('/top', autoriser('pharmacie.clients.read'), valider(schemaTopClients, 'query'), controleur.top);
router.get(
  '/creances',
  autoriser('pharmacie.clients.read'),
  valider(schemaFiltresCreances, 'query'),
  controleur.creances
);
router.get('/', autoriser('pharmacie.clients.read'), valider(schemaFiltresClients, 'query'), controleur.lister);
router.post('/', autoriser('pharmacie.clients.create'), valider(schemaCreationClient), controleur.creer);

router.get('/:id/creances', autoriser('pharmacie.clients.read'), controleur.creancesClient);
router.get('/:id', autoriser('pharmacie.clients.read'), controleur.detail);
router.patch('/:id', autoriser('pharmacie.clients.update'), valider(schemaModificationClient), controleur.modifier);
router.delete('/:id', autoriser('pharmacie.clients.delete'), controleur.supprimer);

export default router;