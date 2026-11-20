// Routes des ordonnances de la clinique.
// Montage : /api/clinique/ordonnances (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './ordonnances.controller.js';
import {
  schemaAnnulationOrdonnance,
  schemaCreationOrdonnance,
  schemaFiltresOrdonnances,
  schemaModificationOrdonnance,
  schemaServirOrdonnance,
} from './ordonnances.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.ordonnances.read'),
  valider(schemaFiltresOrdonnances, 'query'),
  controleur.lister
);
// Déclaré avant « /:id » pour ne pas être capturé comme un identifiant.
router.get('/a-servir', autoriser('clinique.ordonnances.read'), controleur.aServir);
router.post(
  '/',
  autoriser('clinique.ordonnances.create'),
  valider(schemaCreationOrdonnance),
  controleur.creer
);

router.get('/:id', autoriser('clinique.ordonnances.read'), controleur.detail);
router.patch(
  '/:id',
  autoriser('clinique.ordonnances.update'),
  valider(schemaModificationOrdonnance),
  controleur.modifier
);
// Approbation de la proposition par le Docteur veterinaire : c'est cet acte qui
// transmet l'ordonnance a la pharmacie (permission medicale dediee, distincte du
// service en pharmacie `clinique.ordonnances.validate`).
router.post(
  '/:id/approuver',
  autoriser('clinique.ordonnances.approve'),
  controleur.approuver
);
router.post(
  '/:id/servir',
  autoriser('clinique.ordonnances.validate'),
  valider(schemaServirOrdonnance),
  controleur.servir
);
router.post(
  '/:id/annuler',
  autoriser('clinique.ordonnances.update'),
  valider(schemaAnnulationOrdonnance),
  controleur.annuler
);

export default router;