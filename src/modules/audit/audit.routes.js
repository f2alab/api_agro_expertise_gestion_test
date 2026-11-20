
// Routes du module Audit + Tableau de bord.
// Montage : /api/journal-audit et /api/tableau-de-bord

import { Router } from 'express';
import { z } from 'zod';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { cacheReponse } from '../../middlewares/cacheReponse.js';
import { valider } from '../../middlewares/valider.js';
import { uuid } from '../../utils/validations.js';
import * as controleur from './audit.controller.js';

const schemaFiltresAudit = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  action: z.string().trim().max(60).optional(),
  module: z.string().trim().max(40).optional(),
  statut: z.enum(['SUCCES', 'ECHEC']).optional(),
  utilisateurId: uuid.optional(),
  recherche: z.string().trim().max(120).optional(),
});

const routerAudit = Router();
routerAudit.use(authentifier);
// Réponse identique pour tous les profils autorisés : mise en cache courte
routerAudit.get(
  '/',
  autoriser('iam.audit.read'),
  cacheReponse(),
  valider(schemaFiltresAudit, 'query'),
  controleur.lister
);

const routerTableauDeBord = Router();
routerTableauDeBord.use(authentifier);
routerTableauDeBord.get('/', cacheReponse(), controleur.tableauDeBord);

export { routerAudit, routerTableauDeBord };