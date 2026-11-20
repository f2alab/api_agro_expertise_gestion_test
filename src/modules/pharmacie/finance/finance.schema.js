// Schemas de validation du tableau de bord financier de la pharmacie.

import { z } from 'zod';
import { uuid } from '../../../utils/validations.js';

export const schemaFiltresFinance = z.object({
  pointId: uuid.optional(),
  du: z.string().optional(),
  au: z.string().optional(),
});