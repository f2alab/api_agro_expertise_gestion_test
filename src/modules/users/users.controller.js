
// Contrôleur Utilisateurs : API REST du référentiel des comptes.
// Chaque action de modification est tracée dans le journal d'audit.

import { cree, image, succes } from '../../utils/reponses.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import * as service from './users.service.js';

/** GET /api/utilisateurs */
export async function lister(req, res) {
  const resultat = await service.listerUtilisateurs(req.valide);
  return succes(res, resultat);
}

/** GET /api/utilisateurs/:id */
export async function detail(req, res) {
  const utilisateur = await service.exigerUtilisateur(req.params.id);
  return succes(res, utilisateur);
}

/** POST /api/utilisateurs */
export async function creer(req, res) {
  const resultat = await service.creerUtilisateur(req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'CREATION_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: resultat.utilisateur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      email: resultat.utilisateur.email,
      matricule: resultat.utilisateur.matricule,
      roles: resultat.utilisateur.roles.map((role) => role.code),
    },
  });

  return cree(res, resultat, `/api/utilisateurs/${resultat.utilisateur.id}`);
}

/** PATCH /api/utilisateurs/:id */
export async function modifier(req, res) {
  const utilisateur = await service.modifierUtilisateur(req.params.id, req.valide, req.utilisateur);

  await enregistrerAudit({
    action: 'MODIFICATION_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: utilisateur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champs: Object.keys(req.valide) },
  });

  return succes(res, utilisateur);
}

/** DELETE /api/utilisateurs/:id (archivage logique) */
export async function archiver(req, res) {
  const resultat = await service.archiverUtilisateur(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'ARCHIVAGE_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      email: resultat.email,
      matricule: resultat.matricule,
      nomComplet: resultat.nomComplet,
      statutPrecedent: resultat.statutPrecedent,
      statut: resultat.statut,
      sessionsRevoquees: resultat.sessionsRevoquees,
    },
  });

  return succes(res, resultat);
}

/**
 * GET /api/utilisateurs/:id/photo
 * Renvoie l'image binaire stockée en base (jamais incluse dans les réponses
 * JSON). Accessible à tout profil authentifié : les avatars apparaissent dans
 * les listes et l'en-tête de l'application.
 */
export async function photo(req, res) {
  const resultat = await service.obtenirPhoto(req.params.id);
  return image(req, res, resultat);
}

/** PUT /api/utilisateurs/:id/photo (définir ou remplacer la photo d'un compte) */
export async function modifierPhoto(req, res) {
  const resultat = await service.enregistrerPhoto(req.params.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_PHOTO_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: resultat.utilisateur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      typeMime: resultat.typeMime,
      tailleOctets: resultat.tailleOctets,
      dimensions: resultat.largeur ? `${resultat.largeur}×${resultat.hauteur}` : null,
    },
  });

  return succes(res, resultat.utilisateur);
}

/** DELETE /api/utilisateurs/:id/photo (retirer la photo d'un compte) */
export async function supprimerPhoto(req, res) {
  const resultat = await service.supprimerPhoto(req.params.id);

  await enregistrerAudit({
    action: 'SUPPRESSION_PHOTO_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champ: 'photo' },
  });

  return succes(res, resultat);
}

/** PUT /api/utilisateurs/:id/roles */
export async function affecterRoles(req, res) {
  const utilisateur = await service.remplacerRoles(
    req.params.id,
    req.valide.roleIds,
    req.utilisateur
  );

  await enregistrerAudit({
    action: 'AFFECTATION_ROLES',
    entite: 'utilisateur',
    entiteId: utilisateur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { roles: utilisateur.roles.map((role) => role.code) },
  });

  return succes(res, utilisateur);
}

/** POST /api/utilisateurs/:id/reinitialiser-mot-de-passe */
export async function reinitialiserMotDePasse(req, res) {
  const resultat = await service.reinitialiserMotDePasse(req.params.id, req.utilisateur);

  await enregistrerAudit({
    action: 'REINITIALISATION_MDP_ADMIN',
    entite: 'utilisateur',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      email: resultat.email,
      sessionsRevoquees: resultat.sessionsRevoquees,
    },
  });

  return succes(res, resultat);
}

/** GET /api/utilisateurs/:id/sessions */
export async function sessions(req, res) {
  await service.exigerUtilisateur(req.params.id);
  const resultat = await service.listerSessions(req.params.id);
  return succes(res, resultat);
}

/** DELETE /api/utilisateurs/:id/sessions/:sessionId */
export async function revoquerSession(req, res) {
  const resultat = await service.revoquerSession(req.params.id, req.params.sessionId);

  await enregistrerAudit({
    action: 'REVOCATION_SESSION',
    entite: 'session',
    entiteId: req.params.sessionId,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { utilisateurCible: req.params.id },
  });

  return succes(res, resultat);
}

/** DELETE /api/utilisateurs/:id/sessions */
export async function revoquerToutesLesSessions(req, res) {
  await service.exigerUtilisateur(req.params.id);
  const resultat = await service.revoquerToutesSessions(req.params.id);

  await enregistrerAudit({
    action: 'REVOCATION_SESSIONS',
    entite: 'session',
    entiteId: req.params.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: resultat,
  });

  return succes(res, resultat);
}