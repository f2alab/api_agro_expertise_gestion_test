// Contrôleur des examens paracliniques.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './paraclinique.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/paracliniques */
export async function lister(req, res) {
  return succes(res, await service.listerParacliniques(req.valide));
}

/** GET /api/clinique/paracliniques/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerParaclinique(req.params.id));
}

/** POST /api/clinique/paracliniques */
export async function creer(req, res) {
  const examen = await service.creerParaclinique(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'DEMANDE_EXAMEN_PARACLINIQUE',
    module: MODULE,
    entite: 'clinique_paraclinique',
    entiteId: examen.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: examen.numero, type: examen.typeExamen, libelle: examen.libelle },
  });

  return cree(res, examen, `/api/clinique/paracliniques/${examen.id}`);
}

/** POST /api/clinique/paracliniques/:id/demarrer */
export async function demarrer(req, res) {
  const examen = await service.demarrerParaclinique(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'DEMARRAGE_EXAMEN_PARACLINIQUE',
    module: MODULE,
    entite: 'clinique_paraclinique',
    entiteId: examen.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: examen.numero },
  });

  return succes(res, examen);
}

/** POST /api/clinique/paracliniques/:id/resultat */
export async function resultat(req, res) {
  const examen = await service.enregistrerResultat(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'RESULTAT_EXAMEN_PARACLINIQUE',
    module: MODULE,
    entite: 'clinique_paraclinique',
    entiteId: examen.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: examen.numero, paye: examen.paye, montant: examen.montant },
  });

  return succes(res, examen);
}

/** POST /api/clinique/paracliniques/:id/valider */
export async function valider(req, res) {
  const examen = await service.validerParaclinique(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'VALIDATION_EXAMEN_PARACLINIQUE',
    module: MODULE,
    entite: 'clinique_paraclinique',
    entiteId: examen.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: examen.numero },
  });

  return succes(res, examen);
}

/** POST /api/clinique/paracliniques/:id/annuler */
export async function annuler(req, res) {
  const examen = await service.annulerParaclinique(req.params.id, req.valide.motif);

  await enregistrerAudit({
    action: 'ANNULATION_EXAMEN_PARACLINIQUE',
    module: MODULE,
    entite: 'clinique_paraclinique',
    entiteId: examen.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { numero: examen.numero, motif: req.valide.motif },
  });

  return succes(res, examen);
}