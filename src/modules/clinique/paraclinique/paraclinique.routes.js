// Routes des examens paracliniques.
// Montage : /api/clinique/paracliniques (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './paraclinique.controller.js';
import {
  schemaAnnulationParaclinique,
  schemaCreationParaclinique,
  schemaFiltresParacliniques,
  schemaResultatParaclinique,
} from './paraclinique.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.paracliniques.read'),
  valider(schemaFiltresParacliniques, 'query'),
  controleur.lister
);
router.post(
  '/',
  autoriser('clinique.paracliniques.create'),
  valider(schemaCreationParaclinique),
  controleur.creer
);

router.get('/:id', autoriser('clinique.paracliniques.read'), controleur.detail);
router.post(
  '/:id/demarrer',
  autoriser('clinique.paracliniques.update'),
  controleur.demarrer
);
router.post(
  '/:id/resultat',
  autoriser('clinique.paracliniques.update'),
  valider(schemaResultatParaclinique),
  controleur.resultat
);
router.post(
  '/:id/valider',
  autoriser('clinique.paracliniques.validate'),
  controleur.valider
);
router.post(
  '/:id/annuler',
  autoriser('clinique.paracliniques.update'),
  valider(schemaAnnulationParaclinique),
  controleur.annuler
);

export default router;