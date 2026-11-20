// Routes des produits de la pharmacie.
// Montage : /api/pharmacie/produits (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './produits.controller.js';
import {
  schemaCreationProduit,
  schemaFiltresProduits,
  schemaModificationProduit,
  schemaParametrageProduit,
} from './produits.schema.js';

const router = Router();

router.get('/', autoriser('pharmacie.produits.read'), valider(schemaFiltresProduits, 'query'), controleur.lister);
router.post('/', autoriser('pharmacie.produits.create'), valider(schemaCreationProduit), controleur.creer);

router.get('/:id', autoriser('pharmacie.produits.read'), controleur.detail);
router.get('/:id/parametrage', autoriser('pharmacie.produits.read'), controleur.parametrage);
router.put(
  '/:id/parametrage',
  autoriser('pharmacie.produits.update'),
  valider(schemaParametrageProduit),
  controleur.definirParametrage
);
router.patch('/:id', autoriser('pharmacie.produits.update'), valider(schemaModificationProduit), controleur.modifier);
router.delete('/:id', autoriser('pharmacie.produits.delete'), controleur.supprimer);

export default router;