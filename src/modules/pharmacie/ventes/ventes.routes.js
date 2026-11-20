// Routes des ventes de la pharmacie.
// Montage : /api/pharmacie/ventes (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './ventes.controller.js';
import {
  schemaAnnulationVente,
  schemaCreationRetourVente,
  schemaCreationVente,
  schemaFiltresProduitsVendus,
  schemaFiltresVentes,
  schemaPaiementVente,
} from './ventes.schema.js';

const router = Router();

router.get('/', autoriser('pharmacie.ventes.read'), valider(schemaFiltresVentes, 'query'), controleur.lister);
router.post('/', autoriser('pharmacie.ventes.create'), valider(schemaCreationVente), controleur.creer);

// Rapport « produits vendus » (declare avant « /:id »).
router.get(
  '/produits',
  autoriser('pharmacie.ventes.read'),
  valider(schemaFiltresProduitsVendus, 'query'),
  controleur.produitsVendus
);

router.get('/:id', autoriser('pharmacie.ventes.read'), controleur.detail);
router.post('/:id/annuler', autoriser('pharmacie.ventes.validate'), valider(schemaAnnulationVente), controleur.annuler);
// Retour de produits sur une vente (remise en stock, remboursement / creance).
router.post('/:id/retours', autoriser('pharmacie.ventes.manage'), valider(schemaCreationRetourVente), controleur.retour);
router.post(
  '/:id/paiements',
  autoriser('pharmacie.ventes.create'),
  valider(schemaPaiementVente),
  controleur.paiement
);

export default router;