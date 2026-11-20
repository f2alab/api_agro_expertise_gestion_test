
// Routes du module Permissions.
// Montage : /api/permissions

import { Router } from 'express';
import { z } from 'zod';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { valider } from '../../middlewares/valider.js';
import * as controleur from './permissions.controller.js';

const schemaFiltresPermissions = z.object({
  module: z.string().trim().max(40).optional(),
  action: z.string().trim().max(20).optional(),
  recherche: z.string().trim().max(120).optional(),
});

const router = Router();

router.use(authentifier);

router.get('/', autoriser('iam.permissions.read', 'iam.roles.read'), valider(schemaFiltresPermissions, 'query'), controleur.lister);
router.get('/modules', autoriser('iam.permissions.read', 'iam.roles.read'), controleur.modules);

export default router;