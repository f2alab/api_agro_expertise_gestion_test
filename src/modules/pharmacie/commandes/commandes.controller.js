// Controleur des commandes d'approvisionnement de la pharmacie.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { exigerPorteePoint, resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './commandes.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/commandes */
export async function lister(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerCommandes({ ...req.valide, pointId: pointId ?? undefined }));
}

/** GET /api/pharmacie/commandes/:id */
export async function detail(req, res) {
  const commande = await service.exigerCommande(req.params.id);
  exigerPorteePoint(req.utilisateur, commande.pointId);
  return succes(res, commande);
}

/** POST /api/pharmacie/commandes */
export async function creer(req, res) {
  const donnees = { ...req.valide, pointId: resoudrePointId(req.utilisateur, req.valide.pointId) };
  const commande = await service.creerCommande(donnees, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_COMMANDE',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: commande.numero, totalTTC: commande.totalTTC, lignes: commande.lignes.length },
  });

  return cree(res, commande, `/api/pharmacie/commandes/${commande.id}`);
}

/** PATCH /api/pharmacie/commandes/:id */
export async function modifier(req, res) {
  const existante = await service.exigerCommande(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const commande = await service.modifierCommande(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_COMMANDE',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: commande.numero, champs: Object.keys(req.valide) },
  });

  return succes(res, commande);
}

/** POST /api/pharmacie/commandes/:id/reglements */
export async function regler(req, res) {
  const existante = await service.exigerCommande(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const commande = await service.enregistrerReglement(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'REGLEMENT_COMMANDE',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: commande.numero,
      montant: req.valide.montant,
      mode: req.valide.mode ?? 'ESPECES',
      montantPaye: commande.montantPaye,
      resteAPayer: commande.resteAPayer,
    },
  });

  return cree(res, commande, `/api/pharmacie/commandes/${commande.id}`);
}

/** GET /api/pharmacie/commandes/reglements/en-attente */
export async function reglementsEnAttente(req, res) {
  return succes(res, await service.listerReglementsEnAttente(req.valide, req.utilisateur));
}

/** POST /api/pharmacie/commandes/:id/reglements/:reglementId/valider */
export async function validerReglement(req, res) {
  const existante = await service.exigerCommande(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const commande = await service.validerReglement(
    req.params.id,
    req.params.reglementId,
    req.utilisateur
  );

  await enregistrerAudit({
    action: 'VALIDATION_REGLEMENT_COMMANDE',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: commande.numero,
      reglementId: req.params.reglementId,
      montantPaye: commande.montantPaye,
      resteAPayer: commande.resteAPayer,
    },
  });

  return succes(res, commande);
}

/** POST /api/pharmacie/commandes/:id/reglements/:reglementId/rejeter */
export async function rejeterReglement(req, res) {
  const existante = await service.exigerCommande(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const commande = await service.rejeterReglement(
    req.params.id,
    req.params.reglementId,
    req.valide,
    req.utilisateur
  );

  await enregistrerAudit({
    action: 'REJET_REGLEMENT_COMMANDE',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: commande.numero,
      reglementId: req.params.reglementId,
      motif: req.valide.motif ?? null,
    },
  });

  return succes(res, commande);
}

/** POST /api/pharmacie/commandes/:id/reception */
export async function receptionner(req, res) {
  const existante = await service.exigerCommande(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const commande = await service.receptionnerCommande(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'RECEPTION_COMMANDE',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: commande.numero, statut: commande.statut },
  });

  return succes(res, commande);
}