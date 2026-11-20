// Controleur des inventaires de la pharmacie.
// Cloisonne : un compte rattache a une pharmacie ne gere que SES inventaires.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { exigerPorteePoint, resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './inventaires.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/inventaires */
export async function lister(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerInventaires({ ...req.valide, pointId: pointId ?? undefined }));
}

/** GET /api/pharmacie/inventaires/:id */
export async function detail(req, res) {
  const inventaire = await service.exigerInventaire(req.params.id);
  exigerPorteePoint(req.utilisateur, inventaire.pointId);
  return succes(res, inventaire);
}

/** POST /api/pharmacie/inventaires */
export async function creer(req, res) {
  const donnees = { ...req.valide, pointId: resoudrePointId(req.utilisateur, req.valide.pointId) };
  const inventaire = await service.creerInventaire(donnees, req.utilisateur);

  await enregistrerAudit({
    action: 'OUVERTURE_INVENTAIRE',
    module: MODULE,
    entite: 'pharmacie_inventaire',
    entiteId: inventaire.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: inventaire.numero, point: inventaire.pointNom },
  });

  return cree(res, inventaire, `/api/pharmacie/inventaires/${inventaire.id}`);
}

/** PUT /api/pharmacie/inventaires/:id/comptage */
export async function comptage(req, res) {
  const existant = await service.exigerInventaire(req.params.id);
  exigerPorteePoint(req.utilisateur, existant.pointId);
  const inventaire = await service.enregistrerComptage(req.params.id, req.valide.lignes);
  return succes(res, inventaire);
}

/** POST /api/pharmacie/inventaires/:id/valider */
export async function valider(req, res) {
  const existant = await service.exigerInventaire(req.params.id);
  exigerPorteePoint(req.utilisateur, existant.pointId);
  const inventaire = await service.validerInventaire(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'VALIDATION_INVENTAIRE',
    module: MODULE,
    entite: 'pharmacie_inventaire',
    entiteId: inventaire.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: inventaire.numero, ecarts: inventaire.lignes.filter((l) => l.ecart).length },
  });

  return succes(res, inventaire);
}