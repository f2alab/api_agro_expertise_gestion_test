
// Routes du module Départements.
// Montage : /api/departements

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { valider } from '../../middlewares/valider.js';
import * as controleur from './departments.controller.js';
import {
  schemaCreationDepartement,
  schemaFiltresDepartements,
  schemaModificationDepartement,
} from './departments.schema.js';

const router = Router();

router.use(authentifier);

router.get('/', autoriser('iam.departments.read'), valider(schemaFiltresDepartements, 'query'), controleur.lister);
router.post('/', autoriser('iam.departments.create'), valider(schemaCreationDepartement), controleur.creer);

router.get('/:id', autoriser('iam.departments.read'), controleur.detail);
router.get('/:id/utilisateurs', autoriser('iam.users.read'), controleur.utilisateurs);
router.patch('/:id', autoriser('iam.departments.update'), valider(schemaModificationDepartement), controleur.modifier);
router.delete('/:id', autoriser('iam.departments.delete'), controleur.supprimer);

export default router;