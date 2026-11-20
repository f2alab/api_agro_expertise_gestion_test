
// Routes du module Authentification.
// Montage : /api/auth

import { Router } from 'express';
import { authentifier } from '../../middlewares/authentifier.js';
import { limiteurConnexion } from '../../middlewares/limiteRequetes.js';
import { valider } from '../../middlewares/valider.js';
import * as controleur from './auth.controller.js';
import {
  schemaChangementMotDePasse,
  schemaConnexion,
  schemaDeconnexion,
  schemaDemandeReinitialisation,
  schemaRafraichissement,
  schemaReinitialisation,
} from './auth.schema.js';
import { schemaPhotoUtilisateur } from '../users/users.schema.js';

const router = Router();

// Routes publiques
router.post('/connexion', limiteurConnexion, valider(schemaConnexion), controleur.connecter);
router.post('/rafraichir', valider(schemaRafraichissement), controleur.rafraichir);
router.post('/mot-de-passe/oublie', limiteurConnexion, valider(schemaDemandeReinitialisation), controleur.motDePasseOublie);
router.post('/mot-de-passe/reinitialiser', valider(schemaReinitialisation), controleur.reinitialiserMotDePasse);

// Routes protégées
router.post('/deconnexion', valider(schemaDeconnexion), controleur.deconnecter);
router.get('/moi', authentifier, controleur.moi);
router.post('/mot-de-passe', authentifier, valider(schemaChangementMotDePasse), controleur.changerMotDePasse);
router.get('/sessions', authentifier, controleur.mesSessions);
router.delete('/sessions/:id', authentifier, controleur.revoquerMaSession);

// Photo de profil de l'utilisateur connecté : self-service, aucune permission
// particulière n'est requise (chacun gère sa propre photo).
router.get('/moi/photo', authentifier, controleur.maPhoto);
router.put('/moi/photo', authentifier, valider(schemaPhotoUtilisateur), controleur.modifierMaPhoto);
router.delete('/moi/photo', authentifier, controleur.supprimerMaPhoto);

export default router;