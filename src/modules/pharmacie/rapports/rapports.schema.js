// Schemas de validation des rapports de la pharmacie (situation des ventes et
// de la caisse). La periode est exprimee en jours calendaires (bornes incluses).

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

/** Jour au format AAAA-MM-JJ (fuseau du serveur). */
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ (ex. 2026-03-31).');

/**
 * Filtres de la situation des ventes et de la caisse (indicateurs).
 *  - `pointId` absent  : tout le reseau (profils a portee globale uniquement) ;
 *  - `pointId` fourni  : une pharmacie precise. Un compte cloisonne (PPV,
 *    responsable de pharmacie) est ramene a sa pharmacie de rattachement ;
 *  - `du` / `au` absents : la journee en cours.
 *
 * La liste des ventes n'est PAS paginee ici : elle est servie par
 * `schemaFiltresVentes` (route /rapports/ventes), afin qu'un changement de page
 * ne relance pas le calcul des indicateurs.
 */
export const schemaFiltresSituation = z
  .object({
    pointId: uuid.optional(),
    du: jour.optional(),
    au: jour.optional(),
  })
  .refine((valeurs) => !valeurs.du || !valeurs.au || valeurs.du <= valeurs.au, {
    message: 'La date de debut doit preceder la date de fin.',
    path: ['au'],
  });

/** Booleen tolerant pour les parametres de requete ("1", "true"...). */
const booleenSouple = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1');

/**
 * Filtres du detail des ventes (liste paginee).
 *  - `page` / `limite` : page demandee (1 par defaut) et lignes par page
 *    (50 par defaut, 200 au maximum) ;
 *  - `complet` : toute la periode en une reponse (generation du PV / PDF et de
 *    l'export CSV), plafonnee cote service.
 */
export const schemaFiltresVentes = z
  .object({
    pointId: uuid.optional(),
    du: jour.optional(),
    au: jour.optional(),
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    limite: z.coerce.number().int().min(1).max(200).optional(),
    complet: booleenSouple.optional(),
  })
  .refine((valeurs) => !valeurs.du || !valeurs.au || valeurs.du <= valeurs.au, {
    message: 'La date de debut doit preceder la date de fin.',
    path: ['au'],
  });
