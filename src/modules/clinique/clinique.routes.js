// Agrégateur des routes du module Clinique.
// Montage : /api/clinique - toutes les routes exigent un jeton valide.

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import routesTableauDeBord from './tableau-de-bord/tableau-de-bord.routes.js';
import routesReferentiels from './referentiels/referentiels.routes.js';
import routesProprietaires from './proprietaires/proprietaires.routes.js';
import routesAnimaux from './animaux/animaux.routes.js';
import routesConsultations from './consultations/consultations.routes.js';
import routesParacliniques from './paraclinique/paraclinique.routes.js';
import routesOrdonnances from './ordonnances/ordonnances.routes.js';
import routesFactures from './factures/factures.routes.js';

const router = Router();

router.use(authentifier);

router.use('/tableau-de-bord', routesTableauDeBord);
router.use('/referentiels', routesReferentiels);
router.use('/proprietaires', routesProprietaires);
router.use('/animaux', routesAnimaux);
router.use('/consultations', routesConsultations);
router.use('/paracliniques', routesParacliniques);
router.use('/ordonnances', routesOrdonnances);
router.use('/factures', routesFactures);

export default router;