// Contrôleur des fiches animaux (dossier médical).

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './animaux.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/animaux */
export async function lister(req, res) {
  return succes(res, await service.listerAnimaux(req.valide));
}

/** GET /api/clinique/animaux/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerAnimal(req.params.id));
}

/** GET /api/clinique/animaux/:id/dossier (dossier médical complet) */
export async function dossier(req, res) {
  return succes(res, await service.dossierMedical(req.params.id));
}

/** POST /api/clinique/animaux */
export async function creer(req, res) {
  const animal = await service.creerAnimal(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_ANIMAL',
    module: MODULE,
    entite: 'clinique_animal',
    entiteId: animal.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: animal.code, nom: animal.nom, espece: animal.espece },
  });

  return cree(res, animal, `/api/clinique/animaux/${animal.id}`);
}

/** PATCH /api/clinique/animaux/:id */
export async function modifier(req, res) {
  await service.exigerAnimal(req.params.id);
  const animal = await service.modifierAnimal(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_ANIMAL',
    module: MODULE,
    entite: 'clinique_animal',
    entiteId: animal.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: animal.code, champs: Object.keys(req.valide) },
  });

  return succes(res, animal);
}

/** DELETE /api/clinique/animaux/:id (archivage) */
export async function supprimer(req, res) {
  const resultat = await service.desactiverAnimal(req.params.id);

  await enregistrerAudit({
    action: 'ARCHIVAGE_ANIMAL',
    module: MODULE,
    entite: 'clinique_animal',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: resultat.code, nom: resultat.nom },
  });

  return succes(res, resultat);
}