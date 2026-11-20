// Controleur du magasin central de la pharmacie.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './magasin.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/magasin : vue d'ensemble (stock, activite du jour). */
export async function vueEnsemble(_req, res) {
  return succes(res, await service.vueEnsemble());
}

/** GET /api/pharmacie/magasin/destinations : pharmacies a ravitailler. */
export async function destinations(_req, res) {
  return succes(res, await service.listerDestinations());
}

/** GET /api/pharmacie/magasin/fournisseurs : firmes pour passer commande. */
export async function fournisseurs(_req, res) {
  return succes(res, await service.listerFournisseursExternes());
}

/** GET /api/pharmacie/magasin/stock */
export async function stock(req, res) {
  return succes(res, await service.listerStock(req.valide));
}

/** GET /api/pharmacie/magasin/mouvements */
export async function mouvements(req, res) {
  return succes(res, await service.listerMouvementsMagasin(req.valide));
}

/** GET /api/pharmacie/magasin/alertes */
export async function alertes(req, res) {
  return succes(res, await service.listerAlertesMagasin(req.valide));
}

/** GET /api/pharmacie/magasin/besoins */
export async function besoins(_req, res) {
  return succes(res, await service.listerBesoins());
}

/** GET /api/pharmacie/magasin/commandes */
export async function commandes(req, res) {
  return succes(res, await service.listerCommandesMagasin(req.valide));
}

/** GET /api/pharmacie/magasin/commandes/:id */
export async function detailCommande(req, res) {
  return succes(res, await service.detailCommandeMagasin(req.params.id));
}

/** PATCH /api/pharmacie/magasin/commandes/:id */
export async function modifierCommande(req, res) {
  const commande = await service.modifierCommandeMagasin(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_COMMANDE_MAGASIN',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: commande.numero, statut: commande.statut, champs: Object.keys(req.valide) },
  });

  return succes(res, commande);
}

/** GET /api/pharmacie/magasin/ravitailler/commandes : commandes Envoyee a charger. */
export async function commandesARavitailler(req, res) {
  return succes(res, await service.listerCommandesARavitailler(req.valide));
}

/** GET /api/pharmacie/magasin/ravitailler/commandes/:id */
export async function detailCommandeARavitailler(req, res) {
  return succes(res, await service.detailCommandeARavitailler(req.params.id));
}

/** GET /api/pharmacie/magasin/ravitailler/demandes : file de validation. */
export async function ravitaillements(req, res) {
  return succes(res, await service.listerRavitaillements(req.valide));
}

/** GET /api/pharmacie/magasin/ravitailler/demandes/:id */
export async function detailRavitaillement(req, res) {
  return succes(res, await service.detailRavitaillement(req.params.id));
}

/**
 * POST /api/pharmacie/magasin/ravitailler
 * Enregistre une demande de ravitaillement : aucun stock n'est deplace avant
 * l'approbation par la direction (DG / DGA).
 */
export async function ravitailler(req, res) {
  const demande = await service.creerRavitaillement(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'DEMANDE_RAVITAILLEMENT_MAGASIN',
    module: MODULE,
    entite: 'pharmacie_ravitaillement',
    entiteId: demande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: demande.numero,
      destination: demande.pointDestinationNom,
      commande: demande.commandeNumero ?? null,
      lignes: demande.lignes.length,
      produits: demande.lignes.map((ligne) => ligne.produitNom),
    },
  });

  return cree(res, demande, `/api/pharmacie/magasin/ravitailler/demandes/${demande.id}`);
}

/** POST /api/pharmacie/magasin/ravitailler/:id/approuver (DG / DGA). */
export async function approuverRavitaillement(req, res) {
  const demande = await service.approuverRavitaillement(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'APPROBATION_RAVITAILLEMENT_MAGASIN',
    module: MODULE,
    entite: 'pharmacie_ravitaillement',
    entiteId: demande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: demande.numero,
      destination: demande.pointDestinationNom,
      commande: demande.commandeNumero ?? null,
      quantite: demande.quantiteTotale,
    },
  });

  return succes(res, demande);
}

/** POST /api/pharmacie/magasin/ravitailler/:id/rejeter (DG / DGA). */
export async function rejeterRavitaillement(req, res) {
  const demande = await service.rejeterRavitaillement(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'REJET_RAVITAILLEMENT_MAGASIN',
    module: MODULE,
    entite: 'pharmacie_ravitaillement',
    entiteId: demande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: demande.numero, motif: demande.motifRejet ?? null },
  });

  return succes(res, demande);
}

/** POST /api/pharmacie/magasin/commander */
export async function commander(req, res) {
  const commande = await service.commander(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_COMMANDE_MAGASIN',
    module: MODULE,
    entite: 'pharmacie_commande',
    entiteId: commande.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: commande.numero, totalTTC: commande.totalTTC, lignes: commande.lignes.length },
  });

  return cree(res, commande, `/api/pharmacie/magasin/commandes/${commande.id}`);
}

/** POST /api/pharmacie/magasin/commandes/:id/reception */
export async function receptionner(req, res) {
  const commande = await service.receptionner(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'RECEPTION_MAGASIN',
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

/** POST /api/pharmacie/magasin/commandes/:id/reglements */
export async function reglerCommande(req, res) {
  const commande = await service.reglerCommandeMagasin(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'REGLEMENT_COMMANDE_MAGASIN',
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

  return cree(res, commande, `/api/pharmacie/magasin/commandes/${commande.id}`);
}