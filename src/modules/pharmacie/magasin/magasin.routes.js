// Routes du magasin central de la pharmacie.
// Montage : /api/pharmacie/magasin (le routeur parent applique authentifier).

import { Router } from 'express';
import { autoriserToutes } from '../../../middlewares/autoriser.js';
import { valider } from '../../../middlewares/valider.js';
import * as controleur from './magasin.controller.js';
import {
  schemaCommandeMagasin,
  schemaFiltresCommandesARavitailler,
  schemaFiltresRavitaillements,
  schemaRavitaillement,
  schemaReceptionMagasin,
  schemaRejetRavitaillement,
} from './magasin.schema.js';
import {
  schemaFiltresAlertes,
  schemaFiltresMouvements,
  schemaFiltresStock,
} from '../stocks/stocks.schema.js';
import { schemaFiltresCommandes, schemaModificationCommande, schemaReglement } from '../commandes/commandes.schema.js';

const router = Router();

// Acces au module : permission dediee aux gestionnaires du magasin central
// (le responsable de pharmacie ne l'a pas). Chaque route exige ensuite la
// permission de l'operation (lecture, ravitaillement, commande, reception).
const ACCES = 'pharmacie.magasin.acces';

// Consultation (gestionnaires du magasin : DG, DGA, Directeur Technique,
// Comptable, Tresorier, Auditeur...).
router.get('/', autoriserToutes(ACCES, 'pharmacie.magasin.read'), controleur.vueEnsemble);
router.get('/destinations', autoriserToutes(ACCES, 'pharmacie.magasin.read'), controleur.destinations);
router.get('/fournisseurs', autoriserToutes(ACCES, 'pharmacie.magasin.commande'), controleur.fournisseurs);
router.get('/stock', autoriserToutes(ACCES, 'pharmacie.magasin.read'), valider(schemaFiltresStock, 'query'), controleur.stock);
router.get('/mouvements', autoriserToutes(ACCES, 'pharmacie.magasin.read'), valider(schemaFiltresMouvements, 'query'), controleur.mouvements);
router.get('/alertes', autoriserToutes(ACCES, 'pharmacie.magasin.read'), valider(schemaFiltresAlertes, 'query'), controleur.alertes);
router.get('/besoins', autoriserToutes(ACCES, 'pharmacie.magasin.read'), controleur.besoins);
router.get('/commandes', autoriserToutes(ACCES, 'pharmacie.magasin.read'), valider(schemaFiltresCommandes, 'query'), controleur.commandes);
router.get('/commandes/:id', autoriserToutes(ACCES, 'pharmacie.magasin.read'), controleur.detailCommande);
// Modification d'une commande du magasin : brouillon (lignes, commentaire,
// livraison) ou changement de statut (validation, annulation).
router.patch(
  '/commandes/:id',
  autoriserToutes(ACCES, 'pharmacie.magasin.commande'),
  valider(schemaModificationCommande),
  controleur.modifierCommande
);

// Operations : ravitaillement des pharmacies, commande et reception firmes.
// Chargement des commandes ENVOYEE de la pharmacie de destination (fournisseur
// = Pharmacie du Siege) pour le mode « a partir d'une commande ».
router.get(
  '/ravitailler/commandes',
  autoriserToutes(ACCES, 'pharmacie.magasin.transfert'),
  valider(schemaFiltresCommandesARavitailler, 'query'),
  controleur.commandesARavitailler
);
router.get(
  '/ravitailler/commandes/:id',
  autoriserToutes(ACCES, 'pharmacie.magasin.transfert'),
  controleur.detailCommandeARavitailler
);
// File des demandes de ravitaillement (approbation par le DG / DGA).
router.get(
  '/ravitailler/demandes',
  autoriserToutes(ACCES, 'pharmacie.magasin.read'),
  valider(schemaFiltresRavitaillements, 'query'),
  controleur.ravitaillements
);
router.get(
  '/ravitailler/demandes/:id',
  autoriserToutes(ACCES, 'pharmacie.magasin.read'),
  controleur.detailRavitaillement
);
// Creation d'une demande : le transfert n'est execute qu'a l'approbation.
router.post('/ravitailler', autoriserToutes(ACCES, 'pharmacie.magasin.transfert'), valider(schemaRavitaillement), controleur.ravitailler);
router.post(
  '/ravitailler/:id/approuver',
  autoriserToutes(ACCES, 'pharmacie.magasin.transfert.valider'),
  controleur.approuverRavitaillement
);
router.post(
  '/ravitailler/:id/rejeter',
  autoriserToutes(ACCES, 'pharmacie.magasin.transfert.valider'),
  valider(schemaRejetRavitaillement),
  controleur.rejeterRavitaillement
);
router.post('/commander', autoriserToutes(ACCES, 'pharmacie.magasin.commande'), valider(schemaCommandeMagasin), controleur.commander);
router.post(
  '/commandes/:id/reception',
  autoriserToutes(ACCES, 'pharmacie.magasin.reception'),
  valider(schemaReceptionMagasin),
  controleur.receptionner
);
// Reglement de la facture fournisseur du magasin (suivi des impayes).
router.post(
  '/commandes/:id/reglements',
  autoriserToutes(ACCES, 'pharmacie.magasin.reception'),
  valider(schemaReglement),
  controleur.reglerCommande
);

export default router;