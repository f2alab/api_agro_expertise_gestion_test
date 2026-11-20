
// Routes du module Temps réel.
// Montage : /api/temps-reel
//
// Le filtrage fin se fait par type d'événement (permissions de l'utilisateur),
// il n'y a donc pas de middleware `autoriser` ici : seuls les utilisateurs
// authentifiés peuvent ouvrir un flux.

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import * as controleur from './realtime.controller.js';

const router = Router();

router.use(authentifier);

router.get('/flux', controleur.flux);
router.get('/etat', controleur.etat);
router.get('/types', controleur.types);

export default router;
