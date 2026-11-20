// Agregateur des routes du module Pharmacie.
// Montage : /api/pharmacie - toutes les routes exigent un jeton valide.

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import routesPoints from './points/points.routes.js';
import routesProduits from './produits/produits.routes.js';
import routesReferentiels from './referentiels/referentiels.routes.js';
import routesClients from './clients/clients.routes.js';
import routesFournisseurs from './fournisseurs/fournisseurs.routes.js';
import routesStocks from './stocks/stocks.routes.js';
import routesMagasin from './magasin/magasin.routes.js';
import routesCommandes from './commandes/commandes.routes.js';
import routesInventaires from './inventaires/inventaires.routes.js';
import routesVentes from './ventes/ventes.routes.js';
import routesRapports from './rapports/rapports.routes.js';
import routesFinance from './finance/finance.routes.js';
import routesTableauDeBord from './tableau-de-bord/tableau-de-bord.routes.js';

const router = Router();

router.use(authentifier);

router.use('/tableau-de-bord', routesTableauDeBord);
router.use('/points', routesPoints);
router.use('/produits', routesProduits);
router.use('/referentiels', routesReferentiels);
router.use('/clients', routesClients);
router.use('/fournisseurs', routesFournisseurs);
router.use('/stocks', routesStocks);
router.use('/magasin', routesMagasin);
router.use('/commandes', routesCommandes);
router.use('/inventaires', routesInventaires);
router.use('/ventes', routesVentes);
router.use('/rapports', routesRapports);
router.use('/finance', routesFinance);

export default router;