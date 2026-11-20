
// Agrégateur des routes de l'API (/api).
// Chaque module métier expose son propre routeur : il suffit de l'ajouter ici.

import { Router } from 'express';
import { query } from '../config/database.js';
import { succes } from '../utils/reponses.js';
import routesAuth from '../modules/auth/auth.routes.js';
import routesUtilisateurs from '../modules/users/users.routes.js';
import routesRoles from '../modules/roles/roles.routes.js';
import routesPermissions from '../modules/permissions/permissions.routes.js';
import routesDepartements from '../modules/departments/departments.routes.js';
import { routerAudit, routerTableauDeBord } from '../modules/audit/audit.routes.js';
import routesPharmacie from '../modules/pharmacie/pharmacie.routes.js';
import routesClinique from '../modules/clinique/clinique.routes.js';
import routesFinances from '../modules/finances/finances.routes.js';
import routesDirection from '../modules/direction/direction.routes.js';
import routesTempsReel from '../modules/realtime/realtime.routes.js';
import routesParametres from '../modules/parametres/parametres.routes.js';

const router = Router();

/**
 * GET /api/sante : état de santé de l'API et de la base de données.
 * Route publique utilisée par le frontend et les outils de supervision.
 */
router.get('/sante', async (_req, res) => {
  const { rows } = await query('SELECT now() AS horodatage, current_database() AS base');
  return succes(res, {
    statut: 'OK',
    base: rows[0].base,
    horodatage: rows[0].horodatage,
    version: '1.0.0',
    module: 'IAM',
  });
});

router.use('/auth', routesAuth);
router.use('/utilisateurs', routesUtilisateurs);
router.use('/roles', routesRoles);
router.use('/permissions', routesPermissions);
router.use('/departements', routesDepartements);
router.use('/journal-audit', routerAudit);
router.use('/tableau-de-bord', routerTableauDeBord);
router.use('/pharmacie', routesPharmacie);
router.use('/clinique', routesClinique);
router.use('/finances', routesFinances);
router.use('/direction', routesDirection);
router.use('/temps-reel', routesTempsReel);
router.use('/parametres', routesParametres);

export default router;