
// Routes du module Utilisateurs.
// Montage : /api/utilisateurs
// Chaque route exige une permission précise (RBAC).

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { autoriser } from '../../middlewares/autoriser.js';
import { valider } from '../../middlewares/valider.js';
import * as controleur from './users.controller.js';
import {
  schemaCreationUtilisateur,
  schemaFiltresUtilisateurs,
  schemaModificationUtilisateur,
  schemaPhotoUtilisateur,
  schemaRolesUtilisateur,
} from './users.schema.js';

const router = Router();

// Toutes les routes exigent un jeton valide
router.use(authentifier);

router.get('/', autoriser('iam.users.read'), valider(schemaFiltresUtilisateurs, 'query'), controleur.lister);
router.post('/', autoriser('iam.users.create'), valider(schemaCreationUtilisateur), controleur.creer);

router.get('/:id', autoriser('iam.users.read'), controleur.detail);
router.patch('/:id', autoriser('iam.users.update'), valider(schemaModificationUtilisateur), controleur.modifier);
router.delete('/:id', autoriser('iam.users.delete'), controleur.archiver);

// Photo de profil : lecture ouverte à tout profil authentifié (avatars des
// listes), écriture réservée aux profils habilités à modifier les comptes.
// Un utilisateur gère sa propre photo via /api/auth/moi/photo.
router.get('/:id/photo', controleur.photo);
router.put('/:id/photo', autoriser('iam.users.update'), valider(schemaPhotoUtilisateur), controleur.modifierPhoto);
router.delete('/:id/photo', autoriser('iam.users.update'), controleur.supprimerPhoto);

router.put('/:id/roles', autoriser('iam.roles.assign'), valider(schemaRolesUtilisateur), controleur.affecterRoles);
router.post('/:id/reinitialiser-mot-de-passe', autoriser('iam.users.update'), controleur.reinitialiserMotDePasse);

router.get('/:id/sessions', autoriser('iam.sessions.read'), controleur.sessions);
router.delete('/:id/sessions/:sessionId', autoriser('iam.sessions.manage'), controleur.revoquerSession);
router.delete('/:id/sessions', autoriser('iam.sessions.manage'), controleur.revoquerToutesLesSessions);

export default router;