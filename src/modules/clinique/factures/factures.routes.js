// Routes des factures globales de la clinique.
// Montage : /api/clinique/factures (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './factures.controller.js';
import {
  schemaAnnulationFacture,
  schemaFiltresFactures,
  schemaGenerationFacture,
  schemaPaiementFacture,
} from './factures.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.factures.read'),
  valider(schemaFiltresFactures, 'query'),
  controleur.lister
);
// Aperçu (calcul des rubriques) avant émission : même schéma que la génération.
router.post(
  '/apercu',
  autoriser('clinique.factures.create', 'clinique.factures.read'),
  valider(schemaGenerationFacture),
  controleur.apercu
);
router.post(
  '/',
  autoriser('clinique.factures.create'),
  valider(schemaGenerationFacture),
  controleur.generer
);

router.get('/:id', autoriser('clinique.factures.read'), controleur.detail);
router.post(
  '/:id/paiement',
  autoriser('clinique.factures.validate'),
  valider(schemaPaiementFacture),
  controleur.encaisser
);
router.post(
  '/:id/annuler',
  autoriser('clinique.factures.update'),
  valider(schemaAnnulationFacture),
  controleur.annuler
);

export default router;