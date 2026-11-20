// Contrôleur des référentiels du module Clinique.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './referentiels.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/referentiels */
export async function lister(req, res) {
  return succes(res, await service.listerReferentiels(req.valide));
}

/** POST /api/clinique/referentiels */
export async function creer(req, res) {
  const referentiel = await service.creerReferentiel(req.valide);

  await enregistrerAudit({
    action: 'CREATION_REFERENTIEL_CLINIQUE',
    module: MODULE,
    entite: 'clinique_referentiel',
    entiteId: referentiel.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { type: referentiel.type, code: referentiel.code, libelle: referentiel.libelle },
  });

  return cree(res, referentiel, `/api/clinique/referentiels/${referentiel.id}`);
}

/** PATCH /api/clinique/referentiels/:id */
export async function modifier(req, res) {
  const referentiel = await service.modifierReferentiel(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_REFERENTIEL_CLINIQUE',
    module: MODULE,
    entite: 'clinique_referentiel',
    entiteId: referentiel.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { type: referentiel.type, code: referentiel.code, champs: Object.keys(req.valide) },
  });

  return succes(res, referentiel);
}