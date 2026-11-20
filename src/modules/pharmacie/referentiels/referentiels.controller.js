// Controleur des referentiels produits (categories, unites de mesure, rayons).

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './referentiels.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/referentiels */
export async function lister(req, res) {
  return succes(res, await service.listerReferentiels(req.valide));
}

/** GET /api/pharmacie/referentiels/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerReferentiel(req.params.id));
}

/** POST /api/pharmacie/referentiels */
export async function creer(req, res) {
  const referentiel = await service.creerReferentiel(req.valide);

  await enregistrerAudit({
    action: 'CREATION_REFERENTIEL_PRODUIT',
    module: MODULE,
    entite: 'pharmacie_referentiel',
    entiteId: referentiel.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { type: referentiel.type, code: referentiel.code, libelle: referentiel.libelle },
  });

  return cree(res, referentiel, `/api/pharmacie/referentiels/${referentiel.id}`);
}

/** PATCH /api/pharmacie/referentiels/:id */
export async function modifier(req, res) {
  const referentiel = await service.modifierReferentiel(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_REFERENTIEL_PRODUIT',
    module: MODULE,
    entite: 'pharmacie_referentiel',
    entiteId: referentiel.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, referentiel);
}

/** DELETE /api/pharmacie/referentiels/:id */
export async function supprimer(req, res) {
  const resultat = await service.supprimerReferentiel(req.params.id);

  await enregistrerAudit({
    action: 'SUPPRESSION_REFERENTIEL_PRODUIT',
    module: MODULE,
    entite: 'pharmacie_referentiel',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: resultat,
  });

  return succes(res, resultat);
}