// Contrôleur des factures globales de la clinique.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './factures.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/factures */
export async function lister(req, res) {
  return succes(res, await service.listerFactures(req.valide));
}

/** GET /api/clinique/factures/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerFacture(req.params.id));
}

/** POST /api/clinique/factures/apercu (aucune écriture) */
export async function apercu(req, res) {
  return succes(
    res,
    await service.apercuFacture(req.valide.consultationId, req.valide)
  );
}

/** POST /api/clinique/factures */
export async function generer(req, res) {
  const facture = await service.genererFacture(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'GENERATION_FACTURE_CLINIQUE',
    module: MODULE,
    entite: 'clinique_facture',
    entiteId: facture.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: facture.numero,
      consultation: facture.consultationNumero,
      rubriques: {
        consultation: facture.inclureConsultation,
        examens: facture.inclureExamens,
        ordonnance: facture.inclureOrdonnance,
        autres: facture.inclureAutres,
      },
      montantTotal: facture.montantTotal,
      resteAPayer: facture.resteAPayer,
    },
  });

  return cree(res, facture, `/api/clinique/factures/${facture.id}`);
}

/** POST /api/clinique/factures/:id/paiement */
export async function encaisser(req, res) {
  const facture = await service.encaisserFacture(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'REGLEMENT_FACTURE_CLINIQUE',
    module: MODULE,
    entite: 'clinique_facture',
    entiteId: facture.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      numero: facture.numero,
      montant: req.valide.montant,
      mode: req.valide.mode ?? 'ESPECES',
      resteAPayer: facture.resteAPayer,
    },
  });

  return succes(res, facture);
}

/** POST /api/clinique/factures/:id/annuler */
export async function annuler(req, res) {
  const facture = await service.annulerFacture(req.params.id, req.valide.motif);

  await enregistrerAudit({
    action: 'ANNULATION_FACTURE_CLINIQUE',
    module: MODULE,
    entite: 'clinique_facture',
    entiteId: facture.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: facture.numero, motif: req.valide.motif },
  });

  return succes(res, facture);
}