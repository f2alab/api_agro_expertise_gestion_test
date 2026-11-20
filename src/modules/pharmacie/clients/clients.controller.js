// Controleur des clients de la pharmacie.
// Cloisonne : un compte rattache a une pharmacie ne gere que SES clients.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { exigerPorteePoint, resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './clients.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/clients */
export async function lister(req, res) {
  return succes(res, await service.listerClients(req.valide, req.utilisateur));
}

/** GET /api/pharmacie/clients/top?limite=10 */
export async function top(req, res) {
  return succes(res, await service.listerTopClients(req.valide.limite ?? 10, req.utilisateur));
}

/** GET /api/pharmacie/clients/creances */
export async function creances(req, res) {
  return succes(res, await service.listerDebiteurs(req.valide, req.utilisateur));
}

/** GET /api/pharmacie/clients/:id/creances */
export async function creancesClient(req, res) {
  const client = await service.exigerClient(req.params.id);
  exigerPorteePoint(req.utilisateur, client.pointId);
  return succes(res, await service.listerCreancesClient(req.params.id, req.utilisateur));
}

/** GET /api/pharmacie/clients/:id */
export async function detail(req, res) {
  const client = await service.exigerClient(req.params.id);
  exigerPorteePoint(req.utilisateur, client.pointId);
  return succes(res, client);
}

/** POST /api/pharmacie/clients */
export async function creer(req, res) {
  const donnees = { ...req.valide, pointId: resoudrePointId(req.utilisateur, req.valide.pointId) };
  const client = await service.creerClient(donnees);

  await enregistrerAudit({
    action: 'CREATION_CLIENT',
    module: MODULE,
    entite: 'pharmacie_client',
    entiteId: client.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { nom: client.nom, telephone: client.telephone },
  });

  return cree(res, client, `/api/pharmacie/clients/${client.id}`);
}

/** PATCH /api/pharmacie/clients/:id */
export async function modifier(req, res) {
  const existant = await service.exigerClient(req.params.id);
  exigerPorteePoint(req.utilisateur, existant.pointId);
  const client = await service.modifierClient(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_CLIENT',
    module: MODULE,
    entite: 'pharmacie_client',
    entiteId: client.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, client);
}

/** DELETE /api/pharmacie/clients/:id (desactivation) */
export async function supprimer(req, res) {
  const existant = await service.exigerClient(req.params.id);
  exigerPorteePoint(req.utilisateur, existant.pointId);
  const resultat = await service.supprimerClient(req.params.id);

  await enregistrerAudit({
    action: 'SUPPRESSION_CLIENT',
    module: MODULE,
    entite: 'pharmacie_client',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { nom: resultat.nom },
  });

  return succes(res, resultat);
}