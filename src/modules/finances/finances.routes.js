
// Routes du module Finance (transversal).
// Montage : /api/finances - toutes les routes exigent un jeton valide.

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { valider } from '../../middlewares/valider.js';
import { cacheReponse } from '../../middlewares/cacheReponse.js';
import { middlewarePorteeGlobale } from '../../utils/perimetre.js';
import * as controleur from './finances.controller.js';
import routesComptes from './comptes/comptes.routes.js';
import routesEcheances from './echeances/echeances.routes.js';
import {
  schemaCreationDepense,
  schemaCreationTransaction,
  schemaFiltresDepenses,
  schemaFiltresIndicateurs,
  schemaFiltresServices,
  schemaFiltresTransactions,
  schemaValidationDepense,
} from './finances.schema.js';

const router = Router();

router.use(authentifier);

// Comptes de paiement (mobile money / banque)
router.use('/comptes', routesComptes);

// Échéances et engagements financiers (obligations, rappels DG/DGA/Comptable)
router.use('/echeances', routesEcheances);

// Services (registre des centres de flux)
router.get(
  '/services',
  autoriser('finance.services.read', 'finance.transactions.read'),
  valider(schemaFiltresServices, 'query'),
  controleur.services
);

// Grand livre - vue consolidée réservée à la direction et au contrôle.
router.get(
  '/transactions',
  autoriser('finance.transactions.read'),
  middlewarePorteeGlobale,
  valider(schemaFiltresTransactions, 'query'),
  controleur.transactions
);
router.post(
  '/transactions',
  autoriser('finance.transactions.create'),
  valider(schemaCreationTransaction),
  controleur.creerTransaction
);

// Indicateurs consolidés - page « Finance du groupe » réservée à la direction.
router.get(
  '/indicateurs',
  autoriser('finance.indicateurs.read'),
  middlewarePorteeGlobale,
  // Indicateurs cloisonnes par service/pharmacie : cle liee au perimetre.
  cacheReponse({ parUtilisateur: true }),
  valider(schemaFiltresIndicateurs, 'query'),
  controleur.indicateurs
);

// Dépenses
router.get(
  '/depenses',
  autoriser('finance.depenses.read'),
  valider(schemaFiltresDepenses, 'query'),
  controleur.depenses
);
router.post(
  '/depenses',
  autoriser('finance.depenses.create'),
  valider(schemaCreationDepense),
  controleur.creerDepense
);
router.get('/depenses/:id', autoriser('finance.depenses.read'), controleur.depenseDetail);
router.post(
  '/depenses/:id/valider',
  autoriser('finance.depenses.validate'),
  valider(schemaValidationDepense),
  controleur.validerDepense
);
router.post(
  '/depenses/:id/rejeter',
  autoriser('finance.depenses.validate'),
  controleur.rejeterDepense
);
router.post(
  '/depenses/:id/annuler',
  // Seul le créateur annule (permission de création + contrôle de propriété).
  autoriser('finance.depenses.create'),
  controleur.annulerDepense
);

export default router;
