// Routes des commandes d'approvisionnement de la pharmacie.
// Montage : /api/pharmacie/commandes (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './commandes.controller.js';
import {
  schemaCreationCommande,
  schemaFiltresCommandes,
  schemaFiltresReglements,
  schemaModificationCommande,
  schemaReception,
  schemaReglement,
  schemaRejetReglement,
} from './commandes.schema.js';

const router = Router();

router.get('/', autoriser('pharmacie.commandes.read'), valider(schemaFiltresCommandes, 'query'), controleur.lister);
router.post('/', autoriser('pharmacie.commandes.create'), valider(schemaCreationCommande), controleur.creer);

// File d'attente des reglements fournisseurs a valider (direction / comptabilite).
router.get(
  '/reglements/en-attente',
  autoriser('finance.depenses.validate'),
  valider(schemaFiltresReglements, 'query'),
  controleur.reglementsEnAttente
);

router.get('/:id', autoriser('pharmacie.commandes.read'), controleur.detail);
router.patch('/:id', autoriser('pharmacie.commandes.update'), valider(schemaModificationCommande), controleur.modifier);
router.post('/:id/reception', autoriser('pharmacie.commandes.validate'), valider(schemaReception), controleur.receptionner);
// Reglement de la facture fournisseur (versement complementaire) : la personne
// qui receptionne peut enregistrer le paiement.
router.post('/:id/reglements', autoriser('pharmacie.commandes.validate'), valider(schemaReglement), controleur.regler);
// Validation / rejet d'une demande de reglement : reserve a l'administration.
router.post(
  '/:id/reglements/:reglementId/valider',
  autoriser('finance.depenses.validate'),
  controleur.validerReglement
);
router.post(
  '/:id/reglements/:reglementId/rejeter',
  autoriser('finance.depenses.validate'),
  valider(schemaRejetReglement),
  controleur.rejeterReglement
);

export default router;