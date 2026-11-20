// Contrôleur des propriétaires d'animaux.

import { cree, succes } from '../../../utils/reponses.js';
import { enregistrerAudit } from '../../audit/audit.service.js';
import * as service from './proprietaires.service.js';

const MODULE = 'clinique';

/** GET /api/clinique/proprietaires */
export async function lister(req, res) {
  return succes(res, await service.listerProprietaires(req.valide));
}

/** GET /api/clinique/proprietaires/:id */
export async function detail(req, res) {
  return succes(res, await service.exigerProprietaire(req.params.id));
}

/** POST /api/clinique/proprietaires */
export async function creer(req, res) {
  const proprietaire = await service.creerProprietaire(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_PROPRIETAIRE_CLINIQUE',
    module: MODULE,
    entite: 'clinique_proprietaire',
    entiteId: proprietaire.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: proprietaire.code, nom: proprietaire.nom, telephone: proprietaire.telephone },
  });

  return cree(res, proprietaire, `/api/clinique/proprietaires/${proprietaire.id}`);
}

/** PATCH /api/clinique/proprietaires/:id */
export async function modifier(req, res) {
  await service.exigerProprietaire(req.params.id);
  const proprietaire = await service.modifierProprietaire(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_PROPRIETAIRE_CLINIQUE',
    module: MODULE,
    entite: 'clinique_proprietaire',
    entiteId: proprietaire.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { code: proprietaire.code, champs: Object.keys(req.valide) },
  });

  return succes(res, proprietaire);
}

/** DELETE /api/clinique/proprietaires/:id (désactivation) */
export async function supprimer(req, res) {
  const resultat = await service.desactiverProprietaire(req.params.id);

  await enregistrerAudit({
    action: 'DESACTIVATION_PROPRIETAIRE_CLINIQUE',
    module: MODULE,
    entite: 'clinique_proprietaire',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { nom: resultat.nom, code: resultat.code },
  });

  return succes(res, resultat);
}