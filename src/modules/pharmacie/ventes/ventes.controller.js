// Controleur des ventes de la pharmacie.
// Le périmètre d'accès est appliqué ici : un compte rattaché à une pharmacie
// (PPV...) ne voit et n'agit que sur les ventes de SA pharmacie.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import { exigerPorteePoint, resoudrePointId } from '../../../utils/perimetre.js';
import * as service from './ventes.service.js';

const MODULE = 'pharmacie';

/** GET /api/pharmacie/ventes */
export async function lister(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(res, await service.listerVentes({ ...req.valide, pointId: pointId ?? undefined }));
}

/** GET /api/pharmacie/ventes/produits (rapport des produits vendus) */
export async function produitsVendus(req, res) {
  const pointId = resoudrePointId(req.utilisateur, req.valide.pointId);
  return succes(
    res,
    await service.listerProduitsVendus({ ...req.valide, pointId: pointId ?? undefined })
  );
}

/** GET /api/pharmacie/ventes/:id */
export async function detail(req, res) {
  const vente = await service.exigerVente(req.params.id);
  exigerPorteePoint(req.utilisateur, vente.pointId);
  return succes(res, vente);
}

/** POST /api/pharmacie/ventes */
export async function creer(req, res) {
  // Un compte non global ne peut vendre que pour sa pharmacie de rattachement.
  const donnees = { ...req.valide, pointId: resoudrePointId(req.utilisateur, req.valide.pointId) };
  const vente = await service.creerVente(donnees, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_VENTE',
    module: MODULE,
    entite: 'pharmacie_vente',
    entiteId: vente.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: vente.numero, totalTTC: vente.totalTTC, lignes: vente.lignes.length },
  });

  return cree(res, vente, `/api/pharmacie/ventes/${vente.id}`);
}

/** POST /api/pharmacie/ventes/:id/annuler */
export async function annuler(req, res) {
  const existante = await service.exigerVente(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const vente = await service.annulerVente(req.params.id, req.valide.motif, req.utilisateur);

  await enregistrerAudit({
    action: 'ANNULATION_VENTE',
    module: MODULE,
    entite: 'pharmacie_vente',
    entiteId: vente.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: vente.numero, motif: req.valide.motif },
  });

  return succes(res, vente);
}

/** POST /api/pharmacie/ventes/:id/paiements */
export async function paiement(req, res) {
  const existante = await service.exigerVente(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const vente = await service.ajouterPaiement(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'PAIEMENT_VENTE',
    module: MODULE,
    entite: 'pharmacie_vente',
    entiteId: vente.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: vente.numero, montant: req.valide.montant, mode: req.valide.mode ?? 'ESPECES' },
  });

  return succes(res, vente);
}

/** POST /api/pharmacie/ventes/:id/retours */
export async function retour(req, res) {
  const existante = await service.exigerVente(req.params.id);
  exigerPorteePoint(req.utilisateur, existante.pointId);
  const vente = await service.creerRetourVente(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'RETOUR_VENTE',
    module: MODULE,
    entite: 'pharmacie_vente',
    entiteId: vente.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: vente.numero,
      lignes: req.valide.lignes.length,
      montantRetourne: vente.montantRetourne,
    },
  });

  return succes(res, vente);
}