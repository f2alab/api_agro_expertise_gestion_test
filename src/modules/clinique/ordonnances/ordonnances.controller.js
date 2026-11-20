// Contrôleur des ordonnances de la clinique.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './ordonnances.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/ordonnances */
export async function lister(req, res) {
  return succes(res, await service.listerOrdonnances(req.valide));
}

/** GET /api/clinique/ordonnances/a-servir */
export async function aServir(_req, res) {
  return succes(res, await service.listerAServir());
}

/** GET /api/clinique/ordonnances/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerOrdonnance(req.params.id));
}

/** POST /api/clinique/ordonnances */
export async function creer(req, res) {
  const ordonnance = await service.creerOrdonnance(req.valide, req.utilisateur);
  const proposition = ordonnance.statut === 'BROUILLON';

  await enregistrerAudit({
    // Le Docteur veterinaire engage directement sa prescription ; les autres
    // profils deposent une proposition soumise a son approbation.
    action: proposition ? 'PROPOSITION_ORDONNANCE' : 'PRESCRIPTION_ORDONNANCE',
    module: MODULE,
    entite: 'clinique_ordonnance',
    entiteId: ordonnance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: ordonnance.numero,
      statut: ordonnance.statut,
      lignes: ordonnance.lignes.length,
      montantTotal: ordonnance.montantTotal,
    },
  });

  return cree(res, ordonnance, `/api/clinique/ordonnances/${ordonnance.id}`);
}

/** PATCH /api/clinique/ordonnances/:id */
export async function modifier(req, res) {
  await service.exigerOrdonnance(req.params.id);
  const ordonnance = await service.modifierOrdonnance(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_ORDONNANCE',
    module: MODULE,
    entite: 'clinique_ordonnance',
    entiteId: ordonnance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: ordonnance.numero, lignes: ordonnance.lignes.length },
  });

  return succes(res, ordonnance);
}

/** POST /api/clinique/ordonnances/:id/approuver */
export async function approuver(req, res) {
  const ordonnance = await service.approuverOrdonnance(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'APPROBATION_ORDONNANCE',
    module: MODULE,
    entite: 'clinique_ordonnance',
    entiteId: ordonnance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: ordonnance.numero,
      lignes: ordonnance.lignes.length,
      montantTotal: ordonnance.montantTotal,
    },
  });

  return succes(res, ordonnance);
}

/** POST /api/clinique/ordonnances/:id/servir */
export async function servir(req, res) {
  const ordonnance = await service.servirOrdonnance(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'ORDONNANCE_SERVIE',
    module: MODULE,
    entite: 'clinique_ordonnance',
    entiteId: ordonnance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: ordonnance.numero, venteId: req.valide.venteId ?? null },
  });

  return succes(res, ordonnance);
}

/** POST /api/clinique/ordonnances/:id/annuler */
export async function annuler(req, res) {
  const ordonnance = await service.annulerOrdonnance(req.params.id, req.valide.motif);

  await enregistrerAudit({
    action: 'ANNULATION_ORDONNANCE',
    module: MODULE,
    entite: 'clinique_ordonnance',
    entiteId: ordonnance.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: ordonnance.numero, motif: req.valide.motif },
  });

  return succes(res, ordonnance);
}