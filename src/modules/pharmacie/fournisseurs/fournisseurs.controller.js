// Controleur des fournisseurs de la pharmacie.
// Cloisonne : un compte rattache a une pharmacie ne gere que SES fournisseurs.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { exigerPorteePoint, resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './fournisseurs.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/fournisseurs */
export async function lister(req, res) {
  return succes(res, await service.listerFournisseurs(req.valide, req.utilisateur));
}

/** GET /api/pharmacie/fournisseurs/:id */
export async function detail(req, res) {
  const fournisseur = await service.exigerFournisseur(req.params.id);
  exigerPorteePoint(req.utilisateur, fournisseur.pointId);
  return succes(res, fournisseur);
}

/** POST /api/pharmacie/fournisseurs */
export async function creer(req, res) {
  const donnees = { ...req.valide, pointId: resoudrePointId(req.utilisateur, req.valide.pointId) };
  const fournisseur = await service.creerFournisseur(donnees);

  await enregistrerAudit({
    action: 'CREATION_FOURNISSEUR',
    module: MODULE,
    entite: 'pharmacie_fournisseur',
    entiteId: fournisseur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: fournisseur.code, nom: fournisseur.nom },
  });

  return cree(res, fournisseur, `/api/pharmacie/fournisseurs/${fournisseur.id}`);
}

/** PATCH /api/pharmacie/fournisseurs/:id */
export async function modifier(req, res) {
  const existant = await service.exigerFournisseur(req.params.id);
  exigerPorteePoint(req.utilisateur, existant.pointId);
  const fournisseur = await service.modifierFournisseur(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_FOURNISSEUR',
    module: MODULE,
    entite: 'pharmacie_fournisseur',
    entiteId: fournisseur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, fournisseur);
}

/** DELETE /api/pharmacie/fournisseurs/:id (desactivation) */
export async function supprimer(req, res) {
  const existant = await service.exigerFournisseur(req.params.id);
  exigerPorteePoint(req.utilisateur, existant.pointId);
  const resultat = await service.desactiverFournisseur(req.params.id);

  await enregistrerAudit({
    action: 'DESACTIVATION_FOURNISSEUR',
    module: MODULE,
    entite: 'pharmacie_fournisseur',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: resultat.code },
  });

  return succes(res, resultat);
}