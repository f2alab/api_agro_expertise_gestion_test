// Routes du parcours de consultation.
// Montage : /api/clinique/consultations (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriser } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './consultations.controller.js';
import {
  schemaAccueil,
  schemaAnnulationConsultation,
  schemaChangementStatut,
  schemaCloture,
  schemaDiagnostic,
  schemaExamen,
  schemaFiltresConsultations,
  schemaModificationConsultation,
  schemaPaiementFrais,
  schemaReouvertureConsultation,
} from './consultations.schema.js';

const router = Router();

router.get(
  '/',
  autoriser('clinique.consultations.read'),
  valider(schemaFiltresConsultations, 'query'),
  controleur.lister
);
// Déclaré avant « /:id » pour ne pas être capturé comme un identifiant.
router.get('/file-attente', autoriser('clinique.consultations.read'), controleur.fileAttente);
// Praticiens sélectionnables comme vétérinaire d'un passage (nom + fonction).
router.get('/veterinaires', autoriser('clinique.consultations.read'), controleur.veterinaires);
router.post(
  '/accueil',
  autoriser('clinique.consultations.create'),
  valider(schemaAccueil),
  controleur.accueillir
);

router.get('/:id', autoriser('clinique.consultations.read'), controleur.detail);
// Correction d'un passage saisi à l'accueil (motif, type, notes) : le service
// d'accueil peut corriger sa propre saisie, le vétérinaire aussi.
router.patch(
  '/:id',
  autoriser('clinique.consultations.update', 'clinique.consultations.create'),
  valider(schemaModificationConsultation),
  controleur.modifier
);
router.post(
  '/:id/paiement',
  autoriser('clinique.consultations.create'),
  valider(schemaPaiementFrais),
  controleur.payerFrais
);
router.post(
  '/:id/examens',
  autoriser('clinique.examens.create'),
  valider(schemaExamen),
  controleur.enregistrerExamen
);
router.post(
  '/:id/diagnostics',
  autoriser('clinique.examens.create'),
  valider(schemaDiagnostic),
  controleur.ajouterDiagnostic
);
router.delete(
  '/:id/diagnostics/:diagnosticId',
  autoriser('clinique.examens.update'),
  controleur.supprimerDiagnostic
);
router.post(
  '/:id/statut',
  autoriser('clinique.consultations.create'),
  valider(schemaChangementStatut),
  controleur.changerStatut
);
router.post(
  '/:id/cloturer',
  autoriser('clinique.consultations.validate'),
  valider(schemaCloture),
  controleur.cloturer
);
// Réouverture d'un dossier clôturé : operation explicite et tracee (le motif
// est journalise et conserve dans les notes du dossier).
router.post(
  '/:id/rouvrir',
  autoriser('clinique.consultations.validate'),
  valider(schemaReouvertureConsultation),
  controleur.rouvrir
);
// Annulation d'un passage : `validate` (vétérinaire) ou `delete` (service
// d'accueil, qui peut annuler sa propre saisie).
router.post(
  '/:id/annuler',
  autoriser('clinique.consultations.validate', 'clinique.consultations.delete'),
  valider(schemaAnnulationConsultation),
  controleur.annuler
);

export default router;