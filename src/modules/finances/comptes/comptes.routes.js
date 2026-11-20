// Routes des comptes de paiement.
// Montage : /api/finances/comptes (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './comptes.controller.js';
import {
  schemaCreationCompte,
  schemaFiltresComptes,
  schemaFiltresDisponibles,
  schemaModificationCompte,
} from './comptes.schema.js';

const router = Router();

router.get('/', autoriser('finance.comptes.read'), valider(schemaFiltresComptes, 'query'), controleur.lister);
router.post('/', autoriser('finance.comptes.create'), valider(schemaCreationCompte), controleur.creer);

// Comptes utilisables par le profil connecté (sélection lors d'une vente
// ou de l'approbation d'une dépense) : filtré selon le périmètre.
router.get(
  '/disponibles',
  autoriser('finance.transactions.read', 'clinique.consultations.create'),
  valider(schemaFiltresDisponibles, 'query'),
  controleur.disponibles
);
// Soldes des comptes : fonds de départ, entrées, sorties et solde.
router.get(
  '/soldes',
  autoriser('finance.comptes.read'),
  valider(schemaFiltresComptes, 'query'),
  controleur.soldes
);

router.get('/:id', autoriser('finance.comptes.read'), controleur.detail);
router.patch('/:id', autoriser('finance.comptes.update'), valider(schemaModificationCompte), controleur.modifier);
router.delete('/:id', autoriser('finance.comptes.delete'), controleur.supprimer);

export default router;