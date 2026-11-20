// Controleur des produits de la pharmacie (referentiel + parametrage local).

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './produits.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/produits */
export async function lister(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerProduits({ ...req.valide, pointId: pointId ?? undefined }));
}

/** GET /api/pharmacie/produits/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerProduit(req.params.id));
}

/** POST /api/pharmacie/produits */
export async function creer(req, res) {
  // Rattachement automatique a la pharmacie du compte (sinon point choisi).
  const donnees = { ...req.valide, pointId: resoudrePointId(req.utilisateur, req.valide.pointId) };
  const produit = await service.creerProduit(donnees, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_PRODUIT',
    module: MODULE,
    entite: 'pharmacie_produit',
    entiteId: produit.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: produit.code, nomCommercial: produit.nomCommercial },
  });

  return cree(res, produit, `/api/pharmacie/produits/${produit.id}`);
}

/** PATCH /api/pharmacie/produits/:id */
export async function modifier(req, res) {
  const produit = await service.modifierProduit(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_PRODUIT',
    module: MODULE,
    entite: 'pharmacie_produit',
    entiteId: produit.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, produit);
}

/** DELETE /api/pharmacie/produits/:id (desactivation) */
export async function supprimer(req, res) {
  const produit = await service.modifierProduit(req.params.id, { actif: false });

  await enregistrerAudit({
    action: 'DESACTIVATION_PRODUIT',
    module: MODULE,
    entite: 'pharmacie_produit',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: produit.code },
  });

  return succes(res, { id: produit.id, code: produit.code, actif: false });
}

/** GET /api/pharmacie/produits/:id/parametrage */
export async function parametrage(req, res) {
  // Cloisonnement : un compte rattache a une pharmacie ne voit que ses tarifs.
  const pointId = resoudrePointId(req.utilisateur, undefined);
  return succes(res, await service.listerParametrageProduit(req.params.id, pointId));
}

/** PUT /api/pharmacie/produits/:id/parametrage */
export async function definirParametrage(req, res) {
  // Un compte non global ne peut parametrer que SA pharmacie.
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  const parametrage = await service.definirParametrageProduit(req.params.id, { ...req.valide, pointId });

  await enregistrerAudit({
    action: 'PARAMETRAGE_PRODUIT_POINT',
    module: MODULE,
    entite: 'pharmacie_produit_point',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { pointId: req.valide.pointId },
  });

  return succes(res, parametrage);
}