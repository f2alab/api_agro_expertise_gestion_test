
// Routes du module Rôles.
// Montage : /api/roles

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { valider } from '../../middlewares/valider.js';
import * as controleur from './roles.controller.js';
import {
  schemaCreationRole,
  schemaFiltresRoles,
  schemaModificationRole,
  schemaPermissionsRole,
} from './roles.schema.js';

const router = Router();

router.use(authentifier);

router.get('/', autoriser('iam.roles.read'), valider(schemaFiltresRoles, 'query'), controleur.lister);
router.post('/', autoriser('iam.roles.create'), valider(schemaCreationRole), controleur.creer);

router.get('/:id', autoriser('iam.roles.read'), controleur.detail);
router.patch('/:id', autoriser('iam.roles.update'), valider(schemaModificationRole), controleur.modifier);
router.delete('/:id', autoriser('iam.roles.delete'), controleur.supprimer);

router.put('/:id/permissions', autoriser('iam.roles.assign'), valider(schemaPermissionsRole), controleur.affecterPermissions);

export default router;