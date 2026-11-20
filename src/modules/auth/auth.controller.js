
// Contrôleur Authentification : traduction HTTP des services.
// Les contrôleurs restent volontairement minces (aucune logique métier).

import { image, succes } from '../../utils/reponses.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import {
  enregistrerPhoto,
  listerSessions,
  obtenirPhoto,
  obtenirProfilComplet,
  revoquerSession,
  supprimerPhoto,
} from '../users/users.service.js';
import * as serviceAuth from './auth.service.js';

/** POST /api/auth/connexion */
export async function connecter(req, res) {
  const resultat = await serviceAuth.connecter({ ...req.valide, req });
  return succes(res, resultat);
}

/** POST /api/auth/rafraichir */
export async function rafraichir(req, res) {
  const resultat = await serviceAuth.rafraichir({ ...req.valide, req });
  return succes(res, resultat);
}

/** POST /api/auth/deconnexion */
export async function deconnecter(req, res) {
  const resultat = await serviceAuth.deconnecter({
    ...req.valide,
    utilisateur: req.utilisateur,
    req,
  });
  return succes(res, resultat);
}

/** GET /api/auth/moi */
export async function moi(req, res) {
  const profil = await obtenirProfilComplet(req.utilisateur.id);
  return succes(res, profil);
}

/** POST /api/auth/mot-de-passe */
export async function changerMotDePasse(req, res) {
  const resultat = await serviceAuth.changerMotDePasse({
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    ...req.valide,
    req,
  });
  return succes(res, resultat);
}

/** POST /api/auth/mot-de-passe/oublie */
export async function motDePasseOublie(req, res) {
  const resultat = await serviceAuth.demanderReinitialisation({ ...req.valide, req });
  return succes(res, resultat);
}

/** POST /api/auth/mot-de-passe/reinitialiser */
export async function reinitialiserMotDePasse(req, res) {
  const resultat = await serviceAuth.reinitialiserAvecJeton({ ...req.valide, req });
  return succes(res, resultat);
}

/** GET /api/auth/sessions */
export async function mesSessions(req, res) {
  const sessions = await listerSessions(req.utilisateur.id);
  return succes(res, sessions);
}

/** DELETE /api/auth/sessions/:id */
export async function revoquerMaSession(req, res) {
  const resultat = await revoquerSession(req.utilisateur.id, req.params.id);
  return succes(res, resultat);
}

/** GET /api/auth/moi/photo (image binaire, mise en cache par ETag) */
export async function maPhoto(req, res) {
  const resultat = await obtenirPhoto(req.utilisateur.id);
  return image(req, res, resultat);
}

/** PUT /api/auth/moi/photo (définir ou remplacer sa propre photo) */
export async function modifierMaPhoto(req, res) {
  const resultat = await enregistrerPhoto(req.utilisateur.id, req.valide);

  await enregistrerAudit({
    action: 'MODIFICATION_PHOTO_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: req.utilisateur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: {
      typeMime: resultat.typeMime,
      tailleOctets: resultat.tailleOctets,
      dimensions: resultat.largeur ? `${resultat.largeur}×${resultat.hauteur}` : null,
      compte: 'soi-meme',
    },
  });

  return succes(res, resultat.utilisateur);
}

/** DELETE /api/auth/moi/photo (retirer sa propre photo) */
export async function supprimerMaPhoto(req, res) {
  const resultat = await supprimerPhoto(req.utilisateur.id);

  await enregistrerAudit({
    action: 'SUPPRESSION_PHOTO_UTILISATEUR',
    entite: 'utilisateur',
    entiteId: req.utilisateur.id,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { champ: 'photo', compte: 'soi-meme' },
  });

  return succes(res, resultat);
}