// Routes du module Parametres.
// Montage : /api/parametres (le routeur applique authentifier).
//
//   GET  /publics : valeurs publiques, accessibles a tout profil authentifie ;
//   GET  /        : liste complete (permission parametres.systeme.read) ;
//   PUT  /:cle    : modification (permission parametres.systeme.update).
//
// Exception : les cles `affichage.discret.*` (facteur de reduction des montants
// affiches) ne sont listees et modifiables qu'avec la permission
// `parametres.affichage.update`, detenue par la Direction Generale. Le controle
// est applique dans le controleur, ces reglages partageant la route generique.

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { valider } from '../../middlewares/valider.js';
import * as controleur from './parametres.controller.js';
import { schemaMajParametre } from './parametres.schema.js';

const router = Router();

router.use(authentifier);

// Declare avant toute route parametree par `:cle`.
router.get('/publics', autoriser(), controleur.publics);

router.get('/', autoriser('parametres.systeme.read'), controleur.lister);
router.put('/:cle', autoriser('parametres.systeme.update'), valider(schemaMajParametre), controleur.modifier);

export default router;