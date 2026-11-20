// Routes des rapports de la pharmacie (situation des ventes et de la caisse).
// Montage : /api/pharmacie/rapports (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './rapports.controller.js';
import { schemaFiltresSituation, schemaFiltresVentes } from './rapports.schema.js';

const router = Router();

// Situation journaliere (du = au) ou par periode, par pharmacie ou pour tout
// le reseau : le cloisonnement par pharmacie est applique par le controleur.
// Les indicateurs ne dependent que de la periode (aucune pagination ici).
router.get(
  '/situation',
  autoriser('pharmacie.rapports.read'),
  valider(schemaFiltresSituation, 'query'),
  controleur.situation
);

// Detail des ventes PAGINE (page / limite) ou complet (`complet=1` pour le
// PV / PDF et l'export CSV) : changer de page ne relance que cette requete.
router.get(
  '/ventes',
  autoriser('pharmacie.rapports.read'),
  valider(schemaFiltresVentes, 'query'),
  controleur.ventes
);

export default router;