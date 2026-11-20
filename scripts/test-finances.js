// Test de fumee du module Finance (transversal) et de l'isolation des pharmacies.
// Demarre l'API en memoire puis enchaine les appels cles :
//   - grand livre (transactions), indicateurs consolides, depenses ;
//   - isolation : un compte rattache a une pharmacie (PPV) ne voit que la sienne.
// Usage : node scripts/test-finances.js

import { creerApplication } from '../src/app.js';
import { fermerPool } from '../src/config/database.js';

const application = creerApplication();
const serveur = application.listen(0);
await new Promise((resoudre) => serveur.once('listening', resoudre));
const base = `http://127.0.0.1:${serveur.address().port}/api`;

async function appel(chemin, { methode = 'GET', corps, jeton } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  const reponse = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const contenu = await reponse.json().catch(() => null);
  return { statut: reponse.status, contenu };
}

const resultats = [];
const verifier = (libelle, condition, detail = '') => {
  resultats.push({ libelle, ok: Boolean(condition) });
  console.log(`${condition ? 'OK  ' : 'ECHEC'} ${libelle}${detail ? ` - ${detail}` : ''}`);
};

const connexion = async (email, motDePasse) =>
  (await appel('/auth/connexion', { methode: 'POST', corps: { email, motDePasse } })).contenu?.donnees;

const admin = await connexion('admin@agro-expertise.com', 'Admin@2026');
const jetonAdmin = admin.jetonAcces;
verifier('connexion admin', Boolean(jetonAdmin));

// Les comptes de demonstration peuvent avoir ete modifies via l'interface :
// on renormalise leur mot de passe pour rendre le test reproductible.
const MOT_DE_PASSE_DEMO = 'Demo@2026';
const COMPTES_DEMO = [
  'demo.ppv@agro-expertise.com',
  'demo.resp.pharma@agro-expertise.com',
  'demo.dg@agro-expertise.com',
  'demo.dt@agro-expertise.com',
  'demo.tresorier@agro-expertise.com',
  'demo.auditeur@agro-expertise.com',
];
for (const email of COMPTES_DEMO) {
  const liste = await appel(`/utilisateurs?recherche=${encodeURIComponent(email)}`, { jeton: jetonAdmin });
  const compte = (liste.contenu?.donnees?.donnees ?? []).find((u) => u.email === email);
  if (compte) {
    await appel(`/utilisateurs/${compte.id}`, {
      methode: 'PATCH',
      jeton: jetonAdmin,
      corps: { motDePasse: MOT_DE_PASSE_DEMO },
    });
  }
}

// --- Services financiers -----------------------------------------------------
const services = await appel('/finances/services', { jeton: jetonAdmin });
verifier('services financiers', services.statut === 200 && services.contenu.donnees.length >= 7,
  `${services.contenu?.donnees?.length}`);
const servicePharmacie = services.contenu.donnees.find((s) => s.typeService === 'PHARMACIE');

// --- Indicateurs consolides --------------------------------------------------
const indicateurs = await appel('/finances/indicateurs', { jeton: jetonAdmin });
verifier('indicateurs consolides', indicateurs.statut === 200 && indicateurs.contenu.donnees.synthese.entrees > 0,
  JSON.stringify(indicateurs.contenu?.donnees?.synthese));
verifier('regroupement par service', (indicateurs.contenu?.donnees?.parService ?? []).length > 0);
verifier('regroupement par mode', (indicateurs.contenu?.donnees?.parMode ?? []).length > 0);

// --- Grand livre -------------------------------------------------------------
const transactions = await appel('/finances/transactions?limite=10', { jeton: jetonAdmin });
verifier('grand livre', transactions.statut === 200 && transactions.contenu.donnees.donnees.length > 0,
  `${transactions.contenu?.donnees?.pagination?.total}`);
verifier('totaux du grand livre', typeof transactions.contenu.donnees.totaux.solde === 'number');

const saisie = await appel('/finances/transactions', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { serviceId: servicePharmacie.id, sens: 'ENTREE', categorie: 'APPORT', mode: 'VIREMENT', montant: 50000, libelle: 'Apport test' },
});
verifier('saisie manuelle de flux', saisie.statut === 201, saisie.contenu?.donnees?.numero);

// --- Depenses ----------------------------------------------------------------
const pointSiege = (await appel('/pharmacie/points', { jeton: jetonAdmin })).contenu.donnees
  .find((p) => p.typePoint === 'SIEGE');

const depense = await appel('/finances/depenses', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { pointId: pointSiege.id, categorie: 'FONCTIONNEMENT', libelle: 'Depense test', montant: 12000, mode: 'ESPECES' },
});
verifier('creation depense (en attente)', depense.statut === 201 && depense.contenu.donnees.statut === 'EN_ATTENTE',
  depense.contenu?.donnees?.numero);
const depenseId = depense.contenu?.donnees?.id;

const avant = (await appel('/finances/transactions?categorie=DEPENSE', { jeton: jetonAdmin })).contenu.donnees.pagination.total;

// Separation des taches : celui qui soumet la depense ne peut pas l'approuver.
const autoValidation = await appel(`/finances/depenses/${depenseId}/valider`, {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: {},
});
verifier(
  'depense : auto-validation refusee (auteur)',
  autoValidation.statut === 403 && autoValidation.contenu?.erreur?.code === 'DEPENSE_AUTO_VALIDATION',
  `${autoValidation.statut} / ${autoValidation.contenu?.erreur?.code}`
);

// Approbation par un autre utilisateur habilite : compte de test dedie (role
// COMPTABLE), cree au besoin. Le test ne depend ainsi pas des comptes de
// demonstration, qui peuvent ne pas exister selon l'environnement.
const EMAIL_VALIDEUR = 'test.valideur.finances@agro-expertise.com';
const MOT_DE_PASSE_VALIDEUR = 'Test@2026';
// La liste des roles renvoie un tableau (pas d'enveloppe paginee).
const rolesDisponibles = await appel('/roles', { jeton: jetonAdmin });
const roleComptable = (rolesDisponibles.contenu?.donnees ?? []).find(
  (role) => role.code === 'COMPTABLE'
);
const comptesValideurs = await appel(
  `/utilisateurs?recherche=${encodeURIComponent(EMAIL_VALIDEUR)}`,
  { jeton: jetonAdmin }
);
const compteValideur = (comptesValideurs.contenu?.donnees?.donnees ?? []).find(
  (compte) => compte.email === EMAIL_VALIDEUR
);
let valideurId = compteValideur?.id ?? null;
if (valideurId) {
  // Deja cree : on renormalise son mot de passe (il a pu etre change).
  await appel(`/utilisateurs/${valideurId}`, {
    methode: 'PATCH',
    jeton: jetonAdmin,
    corps: { motDePasse: MOT_DE_PASSE_VALIDEUR },
  });
} else {
  const creationValideur = await appel('/utilisateurs', {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: {
      nom: 'Valideur',
      prenom: 'Test',
      email: EMAIL_VALIDEUR,
      motDePasse: MOT_DE_PASSE_VALIDEUR,
      roleIds: roleComptable ? [roleComptable.id] : [],
    },
  });
  valideurId = creationValideur.contenu?.donnees?.id ?? null;
}
// Le role de validation est (re)affecte a chaque execution.
if (valideurId && roleComptable) {
  await appel(`/utilisateurs/${valideurId}/roles`, {
    methode: 'PUT',
    jeton: jetonAdmin,
    corps: { roleIds: [roleComptable.id] },
  });
}
const valideur = await connexion(EMAIL_VALIDEUR, MOT_DE_PASSE_VALIDEUR);
verifier(
  'compte valideur disponible',
  Boolean(valideur?.jetonAcces) && Boolean(roleComptable),
  valideur ? (roleComptable ? 'connecte (COMPTABLE)' : 'role COMPTABLE introuvable') : 'connexion refusee'
);

const validation = await appel(`/finances/depenses/${depenseId}/valider`, {
  methode: 'POST',
  jeton: valideur?.jetonAcces,
  corps: {},
});
verifier('validation depense', validation.statut === 200 && validation.contenu.donnees.statut === 'VALIDEE');
verifier(
  'depense : approuvee par un autre compte',
  Boolean(validation.contenu?.donnees?.valideParNom) &&
    validation.contenu.donnees.valideParNom !==
      `${admin.utilisateur.nom} ${admin.utilisateur.prenom}`,
  validation.contenu?.donnees?.valideParNom
);
const apres = (await appel('/finances/transactions?categorie=DEPENSE', { jeton: jetonAdmin })).contenu.donnees.pagination.total;
verifier('validation depense -> ecriture au grand livre', apres === avant + 1, `${avant} -> ${apres}`);


// --- Isolation : compte PPV rattache a une pharmacie --------------------------
const ppv = await connexion('demo.ppv@agro-expertise.com', 'Demo@2026');
const jetonPpv = ppv.jetonAcces;
verifier('connexion PPV', Boolean(jetonPpv));
verifier('PPV rattache a une pharmacie', Boolean(ppv.utilisateur.pointVenteId),
  `${ppv.utilisateur.pointVenteCode} / porteeGlobale=${ppv.utilisateur.porteeGlobale}`);
verifier('portee globale du PPV = false', ppv.utilisateur.porteeGlobale === false);

const pointsPpv = await appel('/pharmacie/points', { jeton: jetonPpv });
verifier('PPV ne voit que sa pharmacie', pointsPpv.statut === 200 && pointsPpv.contenu.donnees.length === 1,
  `${pointsPpv.contenu?.donnees?.length}`);
verifier('la pharmacie du PPV est bien la sienne', pointsPpv.contenu.donnees[0]?.id === ppv.utilisateur.pointVenteId);

// Le PPV demande explicitement les ventes du siege : le serveur doit ignorer et
// rester dans son perimetre (aucune vente du siege ne doit remonter).
const ventesPpv = await appel(`/pharmacie/ventes?pointId=${pointSiege.id}`, { jeton: jetonPpv });
const fuite = (ventesPpv.contenu?.donnees?.donnees ?? []).filter((v) => v.pointId !== ppv.utilisateur.pointVenteId);
verifier('filtre impose : aucune vente hors perimetre', fuite.length === 0);

// Le PPV tente d'acceder a une vente du siege -> 403.
const ventesAdmin = await appel(`/pharmacie/ventes?pointId=${pointSiege.id}&limite=1`, { jeton: jetonAdmin });
const venteSiege = ventesAdmin.contenu?.donnees?.donnees?.[0];
if (venteSiege) {
  const acces = await appel(`/pharmacie/ventes/${venteSiege.id}`, { jeton: jetonPpv });
  verifier('acces refuse a une vente hors perimetre (403)', acces.statut === 403, String(acces.statut));
}

// La page « Finance du groupe » est réservée à la direction : le PPV est bloqué.
const finPpv = await appel('/finances/transactions', { jeton: jetonPpv });
verifier('finances groupe interdites au PPV (403)', finPpv.statut === 403, String(finPpv.statut));

// --- Tableau de bord pharmacie : cloisonne pour le PPV -------------------------
const dashPpv = await appel('/pharmacie/tableau-de-bord', { jeton: jetonPpv });
const parPointPpv = dashPpv.contenu?.donnees?.finance?.parPoint ?? [];
verifier(
  'dashboard PPV : finance limitee a sa pharmacie',
  dashPpv.statut === 200 && parPointPpv.every((p) => p.pointId === ppv.utilisateur.pointVenteId),
  `${parPointPpv.length} point(s)`
);
const ventesRecentesHors = (dashPpv.contenu?.donnees?.ventesRecentes ?? []).filter(
  (v) => v.pointNom !== ppv.utilisateur.pointVenteNom
);
verifier('dashboard PPV : ventes recentes de sa pharmacie', ventesRecentesHors.length === 0);

const dashAdmin = await appel('/pharmacie/tableau-de-bord', { jeton: jetonAdmin });
verifier(
  'dashboard direction : vue consolidée multi-pharmacies',
  dashAdmin.statut === 200 && (dashAdmin.contenu?.donnees?.finance?.parPoint ?? []).length > 1,
  `${(dashAdmin.contenu?.donnees?.finance?.parPoint ?? []).length} points`
);

// --- Gestion des produits par pharmacie ---------------------------------------
// Creation par un profil global en ciblant une pharmacie : le produit rejoint
// la liste de cette pharmacie avec son tarif.
const codeProduit = `TST${Date.now().toString().slice(-6)}`;
const produitCree = await appel('/pharmacie/produits', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { code: codeProduit, nomCommercial: 'Produit test succursale', pointId: pointSiege.id, prixVente: 1500 },
});
verifier('creation produit rattachee a une pharmacie', produitCree.statut === 201, produitCree.contenu?.donnees?.code);
const produitId = produitCree.contenu?.donnees?.id;

const paramAdmin = await appel(`/pharmacie/produits/${produitId}/parametrage`, { jeton: jetonAdmin });
verifier(
  'produit present dans le parametrage de la pharmacie ciblee',
  (paramAdmin.contenu?.donnees ?? []).some((p) => p.pointId === pointSiege.id && Number(p.prixVente) === 1500)
);

const paramPpv = await appel(`/pharmacie/produits/${produitId}/parametrage`, { jeton: jetonPpv });
verifier(
  'parametrage cloisonne pour le PPV',
  paramPpv.statut === 200 && (paramPpv.contenu?.donnees ?? []).every((p) => p.pointId === ppv.utilisateur.pointVenteId),
  `${paramPpv.contenu?.donnees?.length} ligne(s)`
);

// --- Approvisionnement interne (magasin -> succursale) ------------------------
const fournisseurs = (await appel('/pharmacie/fournisseurs?limite=100', { jeton: jetonAdmin })).contenu.donnees;
const pointsTous = (await appel('/pharmacie/points', { jeton: jetonAdmin })).contenu.donnees;
const succursale = pointsTous.find((p) => p.code === 'PH-AGOE');
const magasin = pointsTous.find((p) => p.typePoint === 'MAGASIN');
verifier('magasin central disponible', Boolean(magasin?.id), magasin?.code);
const fournisseurInterne = fournisseurs.find((f) => f.code === `INT-${succursale?.code}`);
verifier('fournisseur interne expose par l API', Boolean(fournisseurInterne), fournisseurInterne?.nom);
verifier('type du fournisseur interne', fournisseurInterne?.typeFournisseur === 'INTERNE');

if (fournisseurInterne && succursale) {
  const catalogueSiege = (await appel(`/pharmacie/stocks/catalogue?pointId=${pointSiege.id}`, { jeton: jetonAdmin })).contenu.donnees;
  const produitTransfert = catalogueSiege.find((p) => p.quantite >= 5);

  const commande = await appel('/pharmacie/commandes', {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: {
      pointId: succursale.id,
      fournisseurId: fournisseurInterne.id,
      lignes: [{ produitId: produitTransfert.id, quantiteCommandee: 3, prixUnitaire: 1000 }],
    },
  });
  verifier('creation commande interne', commande.statut === 201, commande.contenu?.donnees?.numero);
  const commandeId = commande.contenu?.donnees?.id;

  const detail = await appel(`/pharmacie/commandes/${commandeId}`, { jeton: jetonAdmin });
  const lignesReception = (detail.contenu?.donnees?.lignes ?? []).map((ligne) => ({
    ligneId: ligne.id,
    quantiteRecue: ligne.quantiteCommandee - ligne.quantiteRecue,
  }));
  const reception = await appel(`/pharmacie/commandes/${commandeId}/reception`, {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: { lignes: lignesReception, montantFacture: 3000 },
  });
  verifier('reception commande interne', reception.statut === 200, reception.contenu?.donnees?.statut);

  // Le controle de stock est fait ci-dessous sur un produit DEDIE (isole des
  // autres tests) pour rester fiable meme si des suites tournent en parallele.

  // Un produit nouveau (rattache au siege uniquement) livre a la succursale
  // doit entrer dans SA liste et devenir visible dans son catalogue.
  const codeNouveau = `NEW${Date.now().toString().slice(-6)}`;
  const nouveau = await appel('/pharmacie/produits', {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: { code: codeNouveau, nomCommercial: 'Produit nouveau (siege)', pointId: pointSiege.id, prixVente: 2000 },
  });
  const nouveauId = nouveau.contenu?.donnees?.id;

  const catalogueAvant = (await appel(`/pharmacie/stocks/catalogue?pointId=${succursale.id}&t=${Date.now()}`, { jeton: jetonAdmin })).contenu.donnees;
  verifier('produit absent de la succursale avant livraison', !catalogueAvant.some((p) => p.id === nouveauId));

  // Le magasin central doit connaitre le produit pour pouvoir le distribuer.
  if (magasin) {
    await appel(`/pharmacie/produits/${nouveauId}/parametrage`, {
      methode: 'PUT',
      jeton: jetonAdmin,
      corps: { pointId: magasin.id, prixVente: 2000, prixAchatReference: 1000, seuilAlerte: 0, disponible: true },
    });
  }

  await appel('/pharmacie/stocks/mouvements', {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: { pointId: magasin.id, produitId: nouveauId, typeMouvement: 'ENTREE', quantite: 5, prixUnitaire: 1000 },
  });

  const commande2 = await appel('/pharmacie/commandes', {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: { pointId: succursale.id, fournisseurId: fournisseurInterne.id, lignes: [{ produitId: nouveauId, quantiteCommandee: 2, prixUnitaire: 1000 }] },
  });
  const commande2Id = commande2.contenu?.donnees?.id;
  const detail2 = await appel(`/pharmacie/commandes/${commande2Id}`, { jeton: jetonAdmin });
  const lignes2 = (detail2.contenu?.donnees?.lignes ?? []).map((ligne) => ({ ligneId: ligne.id, quantiteRecue: ligne.quantiteCommandee }));
  const reception2 = await appel(`/pharmacie/commandes/${commande2Id}/reception`, {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: { lignes: lignes2, montantFacture: 2000 },
  });
  verifier('reception du produit nouveau', reception2.statut === 200, reception2.contenu?.donnees?.statut);

  const magasinNouveau = (await appel(`/pharmacie/stocks/catalogue?pointId=${magasin.id}&t=${Date.now()}`, { jeton: jetonAdmin })).contenu.donnees.find((p) => p.id === nouveauId);
  verifier('transfert interne : stock du magasin debite', magasinNouveau?.quantite === 3, `5 -> ${magasinNouveau?.quantite}`);

  const succursaleNouveau = (await appel(`/pharmacie/stocks/catalogue?pointId=${succursale.id}&t=${Date.now()}`, { jeton: jetonAdmin })).contenu.donnees.find((p) => p.id === nouveauId);
  verifier('transfert interne : stock de la succursale credite', (succursaleNouveau?.quantite ?? 0) === 2, `${succursaleNouveau?.quantite}`);

  const catalogueApres = (await appel(`/pharmacie/stocks/catalogue?pointId=${succursale.id}&t=${Date.now()}`, { jeton: jetonAdmin })).contenu.donnees;
  verifier('produit livre ajoute a la liste de la succursale', catalogueApres.some((p) => p.id === nouveauId));
}

// --- Responsable de pharmacie : cloisonne a SA pharmacie ---------------------
const resp = await connexion('demo.resp.pharma@agro-expertise.com', 'Demo@2026');
const jetonResp = resp.jetonAcces;
verifier('connexion responsable pharmacie', Boolean(jetonResp));
verifier('responsable rattache a une pharmacie', Boolean(resp.utilisateur.pointVenteId), resp.utilisateur.pointVenteCode);
verifier('portee globale du responsable = false', resp.utilisateur.porteeGlobale === false);

const pointsResp = await appel('/pharmacie/points', { jeton: jetonResp });
verifier(
  'responsable : une seule pharmacie visible',
  pointsResp.statut === 200 && pointsResp.contenu.donnees.length === 1,
  `${pointsResp.contenu?.donnees?.length}`
);

const ventesResp = await appel(`/pharmacie/ventes?pointId=${pointSiege.id}`, { jeton: jetonResp });
const fuiteResp = (ventesResp.contenu?.donnees?.donnees ?? []).filter((v) => v.pointId !== resp.utilisateur.pointVenteId);
verifier('responsable : aucune vente hors de sa pharmacie', ventesResp.statut === 200 && fuiteResp.length === 0);

const valoResp = await appel('/pharmacie/stocks/valorisation?limite=100', { jeton: jetonResp });
const valoHors = (valoResp.contenu?.donnees?.donnees ?? []).filter(
  (v) => v.pointId !== resp.utilisateur.pointVenteId
);
verifier(
  'responsable : stock limite a sa pharmacie',
  valoHors.length === 0,
  `${valoResp.contenu?.donnees?.donnees?.length} ligne(s) / ${valoResp.contenu?.donnees?.pagination?.total}`
);

const finResp = await appel('/finances/indicateurs', { jeton: jetonResp });
verifier('responsable : page finance groupe refusee (403)', finResp.statut === 403, String(finResp.statut));

const directionResp = await appel('/direction/tableau-de-bord', { jeton: jetonResp });
verifier('responsable : vue groupe (direction) refusee (403)', directionResp.statut === 403, String(directionResp.statut));

// --- Direction : portee globale (DG et Directeur Technique) ------------------
const dg = await connexion('demo.dg@agro-expertise.com', 'Demo@2026');
verifier('DG a une portee globale', dg.utilisateur.porteeGlobale === true);
const directionDg = await appel('/direction/tableau-de-bord', { jeton: dg.jetonAcces });
verifier('DG accede a la vue groupe', directionDg.statut === 200, String(directionDg.statut));

const finDg = await appel('/finances/indicateurs', { jeton: dg.jetonAcces });
verifier('DG accede a la finance du groupe', finDg.statut === 200, String(finDg.statut));

// Validation des depenses : DG autorise, responsable de pharmacie refuse.
const depenseResp = await appel('/finances/depenses', {
  methode: 'POST',
  jeton: jetonResp,
  corps: { libelle: 'Depense responsable', montant: 5000, mode: 'ESPECES' },
});
const validationResp = await appel(`/finances/depenses/${depenseResp.contenu?.donnees?.id}/valider`, {
  methode: 'POST',
  jeton: jetonResp,
  corps: {},
});
verifier('responsable : validation de depense refusee (403)', validationResp.statut === 403, String(validationResp.statut));

const validationDg = await appel(`/finances/depenses/${depenseResp.contenu?.donnees?.id}/valider`, {
  methode: 'POST',
  jeton: dg.jetonAcces,
  corps: {},
});
verifier('DG : validation de depense autorisee', validationDg.statut === 200, String(validationDg.statut));

// Le createur peut annuler sa propre depense en attente.
const depenseAnnul = await appel('/finances/depenses', {
  methode: 'POST',
  jeton: jetonResp,
  corps: { libelle: 'Depense a annuler', montant: 3000, mode: 'ESPECES' },
});
const annulationCreateur = await appel(`/finances/depenses/${depenseAnnul.contenu?.donnees?.id}/annuler`, {
  methode: 'POST',
  jeton: jetonResp,
  corps: {},
});
verifier('createur : annulation de sa depense autorisee', annulationCreateur.statut === 200, String(annulationCreateur.statut));

// Un profil qui n'a pas cree la depense ne peut pas l'annuler.
const depenseAutre = await appel('/finances/depenses', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { libelle: 'Depense admin', montant: 4000, mode: 'ESPECES', pointId: pointSiege.id },
});
const annulationNonCreateur = await appel(`/finances/depenses/${depenseAutre.contenu?.donnees?.id}/annuler`, {
  methode: 'POST',
  jeton: jetonResp,
  corps: {},
});
verifier('non-createur : annulation refusee (403)', annulationNonCreateur.statut === 403, String(annulationNonCreateur.statut));

// Rejet : reserve aux profils habilites (responsable refuse, DG autorise).
const depenseRejet = await appel('/finances/depenses', {
  methode: 'POST',
  jeton: jetonResp,
  corps: { libelle: 'Depense a rejeter', montant: 3500, mode: 'ESPECES' },
});
const rejetResp = await appel(`/finances/depenses/${depenseRejet.contenu?.donnees?.id}/rejeter`, {
  methode: 'POST',
  jeton: jetonResp,
  corps: {},
});
verifier('responsable : rejet de depense refuse (403)', rejetResp.statut === 403, String(rejetResp.statut));

const rejetDg = await appel(`/finances/depenses/${depenseRejet.contenu?.donnees?.id}/rejeter`, {
  methode: 'POST',
  jeton: dg.jetonAcces,
  corps: {},
});
verifier('DG : rejet de depense autorise', rejetDg.statut === 200, String(rejetDg.statut));

// Approbation avec choix du moyen de paiement (comme une vente).
const depensePaiement = await appel('/finances/depenses', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { pointId: pointSiege.id, libelle: 'Depense avec mode', montant: 2000, mode: 'ESPECES' },
});
const validationPaiement = await appel(`/finances/depenses/${depensePaiement.contenu?.donnees?.id}/valider`, {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { mode: 'VIREMENT', reference: 'VIR-123' },
});
verifier(
  'approbation : moyen de paiement pris en compte',
  validationPaiement.statut === 200 &&
    validationPaiement.contenu?.donnees?.mode === 'VIREMENT' &&
    validationPaiement.contenu?.donnees?.reference === 'VIR-123',
  `${validationPaiement.contenu?.donnees?.mode} / ${validationPaiement.contenu?.donnees?.reference}`
);

const dt = await connexion('demo.dt@agro-expertise.com', 'Demo@2026');
verifier('Directeur Technique a une portee globale', dt.utilisateur.porteeGlobale === true);
const directionDt = await appel('/direction/tableau-de-bord', { jeton: dt.jetonAcces });
verifier('Directeur Technique accede a la vue groupe', directionDt.statut === 200, String(directionDt.statut));

// --- Tresorier et Auditeur : portee globale ---------------------------------
const tresorier = await connexion('demo.tresorier@agro-expertise.com', 'Demo@2026');
verifier('Tresorier a une portee globale', tresorier.utilisateur.porteeGlobale === true);
const directionTresorier = await appel('/direction/tableau-de-bord', { jeton: tresorier.jetonAcces });
verifier('Tresorier accede a la vue groupe', directionTresorier.statut === 200, String(directionTresorier.statut));
const finTresorier = await appel('/finances/indicateurs', { jeton: tresorier.jetonAcces });
verifier('Tresorier accede a la finance du groupe', finTresorier.statut === 200, String(finTresorier.statut));

const auditeur = await connexion('demo.auditeur@agro-expertise.com', 'Demo@2026');
verifier('Auditeur a une portee globale', auditeur.utilisateur.porteeGlobale === true);
const directionAuditeur = await appel('/direction/tableau-de-bord', { jeton: auditeur.jetonAcces });
verifier('Auditeur accede a la vue groupe', directionAuditeur.statut === 200, String(directionAuditeur.statut));
const finAuditeur = await appel('/finances/indicateurs', { jeton: auditeur.jetonAcces });
verifier('Auditeur accede a la finance du groupe', finAuditeur.statut === 200, String(finAuditeur.statut));

// --- Clients propres a chaque pharmacie --------------------------------------
const clientKpalime = await appel('/pharmacie/clients', {
  methode: 'POST',
  jeton: jetonResp,
  corps: { nom: 'Client Kpalime', telephone: '+228 91 00 00 01' },
});
verifier('responsable cree un client', clientKpalime.statut === 201, clientKpalime.contenu?.donnees?.nom);
verifier(
  'client rattache a la pharmacie du responsable',
  clientKpalime.contenu?.donnees?.pointId === resp.utilisateur.pointVenteId
);

// Un client cree par la direction a une AUTRE pharmacie ne doit pas fuiter.
const clientSiege = await appel('/pharmacie/clients', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: { nom: 'Client Siege', pointId: pointSiege.id },
});
verifier('client cree au siege', clientSiege.statut === 201, String(clientSiege.contenu?.donnees?.pointNom));

const clientsResp = await appel('/pharmacie/clients', { jeton: jetonResp });
const fuiteClients = (clientsResp.contenu?.donnees ?? []).filter((c) => c.pointId !== resp.utilisateur.pointVenteId);
verifier(
  'responsable : aucun client d une autre pharmacie',
  fuiteClients.length === 0,
  `${clientsResp.contenu?.donnees?.length} client(s)`
);

const clientSiegeInterdit = await appel(`/pharmacie/clients/${clientSiege.contenu?.donnees?.id}`, { jeton: jetonResp });
verifier(
  'responsable : client d une autre pharmacie refuse (403)',
  clientSiegeInterdit.statut === 403,
  String(clientSiegeInterdit.statut)
);

// --- Fournisseurs propres a chaque pharmacie ---------------------------------
const fournisseursResp = await appel('/pharmacie/fournisseurs', { jeton: jetonResp });
const fuiteFournisseurs = (fournisseursResp.contenu?.donnees ?? []).filter((f) => f.pointId !== resp.utilisateur.pointVenteId);
verifier(
  'responsable : aucun fournisseur d une autre pharmacie',
  fuiteFournisseurs.length === 0,
  `${fournisseursResp.contenu?.donnees?.length} fournisseur(s)`
);
verifier(
  'responsable voit son fournisseur interne',
  (fournisseursResp.contenu?.donnees ?? []).some((f) => f.typeFournisseur === 'INTERNE')
);

const fournisseurSiege = (await appel('/pharmacie/fournisseurs', { jeton: jetonAdmin })).contenu.donnees.find(
  (f) => f.pointId === pointSiege.id
);
const fournisseurInterdit = await appel(`/pharmacie/fournisseurs/${fournisseurSiege.id}`, { jeton: jetonResp });
verifier(
  'responsable : fournisseur d une autre pharmacie refuse (403)',
  fournisseurInterdit.statut === 403,
  String(fournisseurInterdit.statut)
);

// --- Comptes de paiement (mobile money / banque) ------------------------------
const comptesAdmin = await appel('/finances/comptes', { jeton: jetonAdmin });
verifier('comptes : liste accessible a la direction', comptesAdmin.statut === 200, `${comptesAdmin.contenu?.donnees?.length} compte(s)`);
verifier(
  'comptes : numeros mobile money semes par point de vente',
  (comptesAdmin.contenu?.donnees ?? []).filter((c) => c.type === 'MOBILE_MONEY').length > 0
);
verifier(
  'comptes : banques disponibles pour virement/cheque',
  (comptesAdmin.contenu?.donnees ?? []).some((c) => c.type === 'BANQUE')
);

const compteCree = await appel('/finances/comptes', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: {
    type: 'MOBILE_MONEY',
    prestataire: 'Mixx By Yas',
    libelle: 'Caisse test',
    numero: '+228 99 11 22 33',
    pointId: resp.utilisateur.pointVenteId,
  },
});
verifier('comptes : creation', compteCree.statut === 201, compteCree.contenu?.donnees?.numero);
verifier(
  'comptes : rattache au point de vente',
  compteCree.contenu?.donnees?.pointId === resp.utilisateur.pointVenteId
);

// --- Fonds de depart et entrees hors ventes ----------------------------------
const compteId = compteCree.contenu?.donnees?.id;
const fondsDepart = await appel('/finances/transactions', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: {
    serviceId: servicePharmacie.id,
    compteId,
    sens: 'ENTREE',
    categorie: 'FONDS_DEPART',
    mode: 'MOBILE_MONEY',
    montant: 250000,
    libelle: 'Fonds de depart test',
  },
});
verifier(
  'fonds de depart : ecriture creee sur le compte',
  fondsDepart.statut === 201 &&
    fondsDepart.contenu?.donnees?.compteId === compteId &&
    fondsDepart.contenu?.donnees?.categorie === 'FONDS_DEPART',
  `${fondsDepart.statut} / ${fondsDepart.contenu?.donnees?.compteId}`
);

// Entree sans service ni pharmacie : rattachee au service « Finance groupe ».
const apportGroupe = await appel('/finances/transactions', {
  methode: 'POST',
  jeton: jetonAdmin,
  corps: {
    sens: 'ENTREE',
    categorie: 'APPORT',
    mode: 'ESPECES',
    montant: 5000,
    libelle: 'Apport groupe test',
  },
});
verifier(
  'fonds : entree sans service rattachee a la Finance groupe',
  apportGroupe.statut === 201 && apportGroupe.contenu?.donnees?.serviceNom === 'Finance groupe',
  `${apportGroupe.statut} / ${apportGroupe.contenu?.donnees?.serviceNom}`
);

const soldesComptes = await appel('/finances/comptes/soldes', { jeton: jetonAdmin });
const soldeDuCompte = (soldesComptes.contenu?.donnees ?? []).find((c) => c.id === compteId);
verifier(
  'soldes : fonds de depart et solde du compte',
  soldesComptes.statut === 200 &&
    Number(soldeDuCompte?.fondsDepart) >= 250000 &&
    Number(soldeDuCompte?.solde) >= 250000,
  `${soldeDuCompte?.fondsDepart} / ${soldeDuCompte?.solde}`
);

const entreesHorsVentes = await appel(
  `/finances/transactions?origine=HORS_OPERATION&compteId=${compteId}`,
  { jeton: jetonAdmin }
);
verifier(
  'grand livre : filtre des entrees hors ventes',
  entreesHorsVentes.statut === 200 &&
    (entreesHorsVentes.contenu?.donnees?.donnees ?? []).some(
      (t) => t.categorie === 'FONDS_DEPART' && t.compteId === compteId
    ),
  `${entreesHorsVentes.contenu?.donnees?.pagination?.total} ecriture(s)`
);

// Le moyens de paiement doit etre coherent avec le type de compte.
const compteBancaire = (comptesAdmin.contenu?.donnees ?? []).find((c) => c.type === 'BANQUE');
if (compteBancaire) {
  const incoherence = await appel('/finances/transactions', {
    methode: 'POST',
    jeton: jetonAdmin,
    corps: {
      serviceId: servicePharmacie.id,
      compteId: compteBancaire.id,
      sens: 'ENTREE',
      categorie: 'APPORT',
      mode: 'ESPECES',
      montant: 1000,
      libelle: 'Test incoherence',
    },
  });
  verifier(
    'fonds : moyen de paiement incoherent refuse (400)',
    incoherence.statut === 400 && incoherence.contenu?.erreur?.code === 'MODE_COMPTE_INCOHERENT',
    `${incoherence.statut} / ${incoherence.contenu?.erreur?.code}`
  );
}

const soldesResp = await appel('/finances/comptes/soldes', { jeton: jetonResp });
verifier(
  'soldes : consultation refusee au responsable (403)',
  soldesResp.statut === 403,
  String(soldesResp.statut)
);

const comptesResp = await appel('/finances/comptes', { jeton: jetonResp });
verifier('comptes : consultation refusee au responsable (403)', comptesResp.statut === 403, String(comptesResp.statut));

const comptesDispoResp = await appel('/finances/comptes/disponibles', { jeton: jetonResp });
verifier(
  'comptes disponibles : accessibles au responsable (perimetre)',
  comptesDispoResp.statut === 200,
  `${comptesDispoResp.contenu?.donnees?.length} compte(s)`
);
verifier(
  'comptes disponibles : ceux du groupe + sa pharmacie uniquement',
  (comptesDispoResp.contenu?.donnees ?? []).every(
    (c) => !c.pointId || c.pointId === resp.utilisateur.pointVenteId
  )
);
verifier(
  'comptes disponibles : aucun compte des autres pharmacies',
  (comptesDispoResp.contenu?.donnees ?? []).every((c) => c.pointId !== pointSiege.id)
);

const comptesDispoBanque = await appel('/finances/comptes/disponibles?type=BANQUE', { jeton: jetonResp });
verifier(
  'comptes disponibles : filtres par moyen (banque)',
  comptesDispoBanque.statut === 200 &&
    (comptesDispoBanque.contenu?.donnees ?? []).every((c) => c.type === 'BANQUE'),
  `${comptesDispoBanque.contenu?.donnees?.length} banque(s)`
);

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} verifications reussies.`);

serveur.close();
await fermerPool();
process.exit(echecs.length > 0 ? 1 : 0);
