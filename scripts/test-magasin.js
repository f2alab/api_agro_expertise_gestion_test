// Test de fumee du magasin central de la pharmacie.
// Verifie la consultation (stock, entrees/sorties, besoins), le ravitaillement
// d'une pharmacie, la commande aux firmes et la reception dans le magasin.
// Usage : node scripts/test-magasin.js

import { creerApplication } from '../src/app.js';
import { fermerPool } from '../src/config/database.js';

const application = creerApplication();
const serveur = application.listen(0);
await new Promise((resoudre) => serveur.once('listening', resoudre));
const base = `http://127.0.0.1:${serveur.address().port}/api`;

async function appel(chemin, options = {}) {
  const reponse = await fetch(`${base}${chemin}`, options);
  const contenu = await reponse.json().catch(() => null);
  return { statut: reponse.status, contenu };
}

const resultats = [];
const verifier = (libelle, condition, detail = '') => {
  resultats.push({ libelle, ok: Boolean(condition) });
  console.log(`${condition ? 'OK  ' : 'ECHEC'} ${libelle}${detail ? ` - ${detail}` : ''}`);
};

async function connexion(email, motDePasse) {
  const r = await appel('/auth/connexion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, motDePasse }),
  });
  return r.contenu?.donnees?.jetonAcces;
}

const jeton = await connexion('admin@agro-expertise.com', 'Admin@2026');
const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };
verifier('connexion administrateur', Boolean(jeton));

// --- Consultation ------------------------------------------------------------
const vue = await appel('/pharmacie/magasin', { headers: entetes });
verifier('vue du magasin', vue.statut === 200 && Boolean(vue.contenu?.donnees?.magasin?.id));
const magasinId = vue.contenu?.donnees?.magasin?.id;
verifier(
  'magasin : stock valorise expose',
  typeof vue.contenu?.donnees?.indicateurs?.valeurStockAchat === 'number',
  `valeur ${vue.contenu?.donnees?.indicateurs?.valeurStockAchat}`
);

const destinations = await appel('/pharmacie/magasin/destinations', { headers: entetes });
verifier(
  'destinations : pharmacies du reseau',
  destinations.statut === 200 && destinations.contenu.donnees.length >= 2,
  `${destinations.contenu?.donnees?.length} pharmacie(s)`
);

const stock = await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes });
const lignesStock = stock.contenu?.donnees?.donnees ?? [];
verifier('stock du magasin (pagine)', stock.statut === 200 && Array.isArray(lignesStock), `${lignesStock.length} ligne(s)`);

// Valorisation globale du magasin (indicateurs de l'ecran Stock), calculee sur
// tout le filtre et non sur la page affichee.
const totauxStock = stock.contenu?.donnees?.totaux;
verifier(
  'stock du magasin : totaux de valorisation',
  typeof totauxStock?.produitsDisponibles === 'number' &&
    typeof totauxStock?.quantite === 'number' &&
    typeof totauxStock?.valeurAchat === 'number' &&
    typeof totauxStock?.valeurVente === 'number' &&
    totauxStock.produitsDisponibles >= 0 &&
    totauxStock.produitsDisponibles <= (stock.contenu?.donnees?.pagination?.total ?? 0) &&
    totauxStock.valeurAchat >= 0 &&
    totauxStock.valeurVente >= 0,
  `${totauxStock?.produitsDisponibles} disponible(s) / ${totauxStock?.quantite} unite(s) / ${totauxStock?.valeurAchat} / ${totauxStock?.valeurVente}`
);

const mouvements = await appel('/pharmacie/magasin/mouvements?limite=5', { headers: entetes });
verifier(
  'mouvements du magasin (entrees/sorties)',
  mouvements.statut === 200 && Array.isArray(mouvements.contenu?.donnees?.donnees)
);

const besoins = await appel('/pharmacie/magasin/besoins', { headers: entetes });
verifier('besoins de reapprovisionnement', besoins.statut === 200 && Array.isArray(besoins.contenu.donnees));
// --- Ravitaillement d'une pharmacie : demande puis validation DG / DGA ------
const produit = lignesStock.find((ligne) => ligne.quantite >= 10);
const destination = destinations.contenu.donnees.find((point) => point.typePoint === 'SUCCURSALE');

if (produit && destination) {
  const quantite = 3;
  const avantMagasin = produit.quantite;

  const avantDest = await appel(
    `/pharmacie/stocks/valorisation?pointId=${destination.id}&recherche=${encodeURIComponent(produit.produitCode)}&limite=100&t=${Date.now()}`,
    { headers: entetes }
  );
  const ligneAvant = (avantDest.contenu?.donnees?.donnees ?? []).find((l) => l.produitId === produit.produitId);
  const qteAvantDest = ligneAvant?.quantite ?? 0;

  const demande = await appel('/pharmacie/magasin/ravitailler', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointDestinationId: destination.id,
      lignes: [{ produitId: produit.produitId, quantite }],
    }),
  });
  verifier(
    'ravitaillement : demande soumise (en attente)',
    demande.statut === 201 && demande.contenu?.donnees?.statut === 'EN_ATTENTE',
    String(demande.contenu?.erreur?.code ?? demande.contenu?.donnees?.statut ?? demande.statut)
  );

  const apresDemande = await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes });
  const ligneApresDemande = (apresDemande.contenu?.donnees?.donnees ?? []).find(
    (l) => l.produitId === produit.produitId
  );
  verifier(
    'ravitaillement : aucun stock deplace avant validation',
    ligneApresDemande?.quantite === avantMagasin,
    `${avantMagasin} -> ${ligneApresDemande?.quantite}`
  );

  const demandeId = demande.contenu?.donnees?.id;
  const approbation = await appel(`/pharmacie/magasin/ravitailler/${demandeId}/approuver`, {
    method: 'POST',
    headers: entetes,
  });
  verifier(
    'ravitaillement : approbation DG/DGA -> stocks transferes',
    approbation.statut === 200 && approbation.contenu?.donnees?.statut === 'APPROUVE',
    String(approbation.contenu?.erreur?.code ?? approbation.contenu?.donnees?.statut ?? approbation.statut)
  );

  const apresStock = await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes });
  const ligneApres = (apresStock.contenu?.donnees?.donnees ?? []).find((l) => l.produitId === produit.produitId);
  verifier(
    'ravitaillement : stock du magasin debite',
    ligneApres?.quantite === avantMagasin - quantite,
    `${avantMagasin} -> ${ligneApres?.quantite}`
  );

  const apresDest = await appel(
    `/pharmacie/stocks/valorisation?pointId=${destination.id}&recherche=${encodeURIComponent(produit.produitCode)}&limite=100&t=${Date.now()}`,
    { headers: entetes }
  );
  const ligneApresDest = (apresDest.contenu?.donnees?.donnees ?? []).find((l) => l.produitId === produit.produitId);
  verifier(
    'ravitaillement : pharmacie creditee',
    (ligneApresDest?.quantite ?? 0) === qteAvantDest + quantite,
    `${qteAvantDest} -> ${ligneApresDest?.quantite}`
  );

  const trop = await appel('/pharmacie/magasin/ravitailler', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointDestinationId: destination.id,
      lignes: [{ produitId: produit.produitId, quantite: 999999 }],
    }),
  });
  verifier('ravitaillement : stock magasin insuffisant refuse (409)', trop.statut === 409, String(trop.statut));
} else {
  verifier('ravitaillement : produit et destination disponibles', false);
}

// --- Ravitaillement multi-produits ------------------------------------------
const stockAvantMulti = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes })).contenu
  ?.donnees?.donnees ?? [];
const produitsMulti = stockAvantMulti.filter((ligne) => ligne.quantite >= 5).slice(0, 2);
const destinationMulti = destinations.contenu.donnees.find((point) => point.typePoint === 'SUCCURSALE');

if (produitsMulti.length === 2 && destinationMulti) {
  const avant = new Map(produitsMulti.map((ligne) => [ligne.produitId, ligne.quantite]));
  const multi = await appel('/pharmacie/magasin/ravitailler', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointDestinationId: destinationMulti.id,
      lignes: produitsMulti.map((ligne) => ({ produitId: ligne.produitId, quantite: 2 })),
    }),
  });
  verifier(
    'ravitaillement multi-produits : demande acceptee',
    multi.statut === 201 && multi.contenu?.donnees?.statut === 'EN_ATTENTE',
    String(multi.contenu?.erreur?.code ?? multi.contenu?.donnees?.statut ?? multi.statut)
  );

  const approbationMulti = await appel(
    `/pharmacie/magasin/ravitailler/${multi.contenu?.donnees?.id}/approuver`,
    { method: 'POST', headers: entetes }
  );
  verifier(
    'ravitaillement multi-produits : approuve',
    approbationMulti.statut === 200 && approbationMulti.contenu?.donnees?.statut === 'APPROUVE'
  );

  const stockApresMulti = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes })).contenu
    ?.donnees?.donnees ?? [];
  const debites = produitsMulti.every((ligne) => {
    const apres = stockApresMulti.find((element) => element.produitId === ligne.produitId);
    return apres?.quantite === avant.get(ligne.produitId) - 2;
  });
  verifier('ravitaillement multi-produits : stocks debites', debites);
} else {
  verifier('ravitaillement multi-produits : produits disponibles', false);
}

// --- Rejet d'une demande : aucun mouvement de stock -------------------------
if (produit && destination) {
  const avantRejet = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes })).contenu
    ?.donnees?.donnees?.find((ligne) => ligne.produitId === produit.produitId)?.quantite;

  const demandeRejetee = await appel('/pharmacie/magasin/ravitailler', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointDestinationId: destination.id,
      lignes: [{ produitId: produit.produitId, quantite: 2 }],
    }),
  });
  const idRejet = demandeRejetee.contenu?.donnees?.id;

  const rejet = await appel(`/pharmacie/magasin/ravitailler/${idRejet}/rejeter`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ motif: 'Test : validation refusee' }),
  });
  verifier(
    'ravitaillement : rejet DG/DGA',
    rejet.statut === 200 && rejet.contenu?.donnees?.statut === 'REJETE',
    String(rejet.contenu?.erreur?.code ?? rejet.contenu?.donnees?.statut ?? rejet.statut)
  );

  const apresRejet = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes })).contenu
    ?.donnees?.donnees?.find((ligne) => ligne.produitId === produit.produitId)?.quantite;
  verifier(
    'ravitaillement : rejet sans mouvement de stock',
    apresRejet === avantRejet,
    `${avantRejet} -> ${apresRejet}`
  );
} else {
  verifier('ravitaillement rejete : produit et destination disponibles', false);
}

// --- Ravitaillement depuis une commande ENVOYEE de la pharmacie --------------
// Seules les commandes dont le fournisseur est la « Pharmacie du Siege »
// (source = magasin central) sont chargees par le magasin.
const destinationCommande = destinations.contenu.donnees.find(
  (point) => point.typePoint === 'SUCCURSALE'
);
const fournisseursInternes = await appel('/pharmacie/fournisseurs?typeFournisseur=INTERNE', {
  headers: entetes,
});
const fournisseurPrincipal = (fournisseursInternes.contenu?.donnees ?? []).find(
  (fournisseur) => fournisseur.principal && fournisseur.pointId === destinationCommande?.id
);
const stockCommande = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes }))
  .contenu?.donnees?.donnees ?? [];
const produitCommande = stockCommande.find((ligne) => ligne.quantite >= 5);

if (destinationCommande && fournisseurPrincipal && produitCommande) {
  const commande = await appel('/pharmacie/commandes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointId: destinationCommande.id,
      fournisseurId: fournisseurPrincipal.id,
      statut: 'ENVOYEE',
      commentaire: 'Commande de test : ravitaillement par le magasin',
      lignes: [
        {
          produitId: produitCommande.produitId,
          quantiteCommandee: 4,
          prixUnitaire: produitCommande.prixAchat ?? 0,
        },
      ],
    }),
  });
  const commandeId = commande.contenu?.donnees?.id;
  verifier(
    'commande succursale -> pharmacie du siege creee',
    commande.statut === 201 && Boolean(commandeId),
    String(commande.contenu?.erreur?.code ?? commande.statut)
  );
  verifier(
    'commande du magasin : reception par transfert signalee',
    commande.contenu?.donnees?.receptionParTransfert === true,
    String(commande.contenu?.donnees?.receptionParTransfert)
  );

  const chargeables = await appel(
    `/pharmacie/magasin/ravitailler/commandes?pointDestinationId=${destinationCommande.id}`,
    { headers: entetes }
  );
  const chargeable = (chargeables.contenu?.donnees ?? []).find((element) => element.id === commandeId);
  verifier(
    'ravitaillement : commande ENVOYEE proposee',
    chargeables.statut === 200 && Boolean(chargeable),
    String(chargeables.contenu?.erreur?.code ?? chargeables.statut)
  );

  const detailCommande = await appel(`/pharmacie/commandes/${commandeId}`, { headers: entetes });
  const ligneCommande = detailCommande.contenu?.donnees?.lignes?.[0];

  // Aucune demande de transfert n'existe encore : la reception manuelle doit
  // etre refusee (l'entree de stock ne peut venir que du transfert approuve).
  const receptionSansTransfert = await appel(`/pharmacie/commandes/${commandeId}/reception`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      lignes: [{ ligneId: ligneCommande?.id, quantiteRecue: 1 }],
    }),
  });
  verifier(
    'commande : reception refusee sans transfert approuve (409)',
    receptionSansTransfert.statut === 409 &&
      receptionSansTransfert.contenu?.erreur?.code === 'RECEPTION_PAR_TRANSFERT_REQUISE',
    String(receptionSansTransfert.contenu?.erreur?.code ?? receptionSansTransfert.statut)
  );

  const avantDestCommande = await appel(
    `/pharmacie/stocks/valorisation?pointId=${destinationCommande.id}&recherche=${encodeURIComponent(produitCommande.produitCode)}&limite=100&t=${Date.now()}`,
    { headers: entetes }
  );
  const qteAvantDestCommande =
    (avantDestCommande.contenu?.donnees?.donnees ?? []).find(
      (ligne) => ligne.produitId === produitCommande.produitId
    )?.quantite ?? 0;

  const demandeCommande = await appel('/pharmacie/magasin/ravitailler', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointDestinationId: destinationCommande.id,
      commandeId,
      commentaire: 'Ravitaillement de la commande de test',
      lignes: [
        {
          produitId: produitCommande.produitId,
          commandeLigneId: ligneCommande?.id,
          quantite: 2,
        },
      ],
    }),
  });
  verifier(
    'ravitaillement depuis commande : demande creee',
    demandeCommande.statut === 201 &&
      demandeCommande.contenu?.donnees?.statut === 'EN_ATTENTE' &&
      demandeCommande.contenu?.donnees?.commandeId === commandeId,
    String(demandeCommande.contenu?.erreur?.code ?? demandeCommande.statut)
  );

  const commandeEnAttente = await appel(`/pharmacie/commandes/${commandeId}`, { headers: entetes });
  verifier(
    'commande : transfert en attente signale',
    commandeEnAttente.contenu?.donnees?.transfertEnAttente === true,
    String(commandeEnAttente.contenu?.donnees?.transfertEnAttente)
  );

  const detailDemande = await appel(
    `/pharmacie/magasin/ravitailler/demandes/${demandeCommande.contenu?.donnees?.id}`,
    { headers: entetes }
  );
  verifier(
    'ravitaillement : detail de la demande (lignes)',
    detailDemande.statut === 200 &&
      detailDemande.contenu?.donnees?.lignes?.length === 1 &&
      detailDemande.contenu?.donnees?.lignes?.[0]?.produitId === produitCommande.produitId,
    `${detailDemande.statut} / ${detailDemande.contenu?.donnees?.lignes?.length}`
  );

  const receptionInterdite = await appel(`/pharmacie/commandes/${commandeId}/reception`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      lignes: [{ ligneId: ligneCommande?.id, quantiteRecue: 1 }],
    }),
  });
  verifier(
    'commande : reception bloquee tant que le transfert n est pas approuve (409)',
    receptionInterdite.statut === 409 &&
      receptionInterdite.contenu?.erreur?.code === 'TRANSFERT_NON_APPROUVE',
    String(receptionInterdite.contenu?.erreur?.code ?? receptionInterdite.statut)
  );

  const approbationCommande = await appel(
    `/pharmacie/magasin/ravitailler/${demandeCommande.contenu?.donnees?.id}/approuver`,
    { method: 'POST', headers: entetes }
  );
  verifier(
    'ravitaillement depuis commande : approuve',
    approbationCommande.statut === 200 &&
      approbationCommande.contenu?.donnees?.statut === 'APPROUVE',
    String(approbationCommande.contenu?.erreur?.code ?? approbationCommande.statut)
  );

  const detailDemandeApres = await appel(
    `/pharmacie/magasin/ravitailler/demandes/${demandeCommande.contenu?.donnees?.id}`,
    { headers: entetes }
  );
  verifier(
    'ravitaillement : quantite transferee visible dans le detail',
    detailDemandeApres.contenu?.donnees?.statut === 'APPROUVE' &&
      detailDemandeApres.contenu?.donnees?.lignes?.[0]?.quantiteTransferee === 2 &&
      detailDemandeApres.contenu?.donnees?.commandeStatut === 'ENVOYEE' &&
      detailDemandeApres.contenu?.donnees?.receptionConfirmee === false &&
      detailDemandeApres.contenu?.donnees?.transfertReceptionne === false,
    `${detailDemandeApres.contenu?.donnees?.statut} / ${detailDemandeApres.contenu?.donnees?.lignes?.[0]?.quantiteTransferee}`
  );

  // L'approbation transfere le stock mais ne cloture PAS la commande : elle
  // reste ENVOYEE jusqu'a la confirmation de reception par la pharmacie.
  const commandeApresTransfert = await appel(`/pharmacie/commandes/${commandeId}`, {
    headers: entetes,
  });
  verifier(
    'commande : reste ENVOYEE apres approbation du transfert',
    commandeApresTransfert.contenu?.donnees?.statut === 'ENVOYEE' &&
      commandeApresTransfert.contenu?.donnees?.lignes?.[0]?.quantiteRecue === 0 &&
      commandeApresTransfert.contenu?.donnees?.transfertApprouve === true &&
      commandeApresTransfert.contenu?.donnees?.lignes?.[0]?.quantiteTransferee === 2,
    `${commandeApresTransfert.contenu?.donnees?.statut} / ${commandeApresTransfert.contenu?.donnees?.lignes?.[0]?.quantiteRecue}`
  );

  const receptionTransfert = await appel(`/pharmacie/commandes/${commandeId}/reception`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      lignes: [{ ligneId: ligneCommande?.id, quantiteRecue: 2 }],
    }),
  });
  verifier(
    'commande : reception du transfert validee (cloture)',
    receptionTransfert.statut === 200 &&
      receptionTransfert.contenu?.donnees?.statut === 'PARTIELLE' &&
      receptionTransfert.contenu?.donnees?.lignes?.[0]?.quantiteRecue === 2,
    `${receptionTransfert.statut} / ${receptionTransfert.contenu?.donnees?.statut} / ${receptionTransfert.contenu?.donnees?.lignes?.[0]?.quantiteRecue}`
  );

  const detailDemandeRecue = await appel(
    `/pharmacie/magasin/ravitailler/demandes/${demandeCommande.contenu?.donnees?.id}`,
    { headers: entetes }
  );
  verifier(
    'ravitaillement : reception confirmee (badge produits recus)',
    detailDemandeRecue.contenu?.donnees?.receptionConfirmee === true &&
      detailDemandeRecue.contenu?.donnees?.transfertReceptionne === true &&
      detailDemandeRecue.contenu?.donnees?.commandeStatut === 'PARTIELLE',
    `${detailDemandeRecue.contenu?.donnees?.receptionConfirmee} / ${detailDemandeRecue.contenu?.donnees?.transfertReceptionne} / ${detailDemandeRecue.contenu?.donnees?.commandeStatut}`
  );

  // Une seconde confirmation ne doit pas compter deux fois la reception.
  const receptionDouble = await appel(`/pharmacie/commandes/${commandeId}/reception`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      lignes: [{ ligneId: ligneCommande?.id, quantiteRecue: 2 }],
    }),
  });
  verifier(
    'commande : pas de double reception (409)',
    receptionDouble.statut === 409 &&
      receptionDouble.contenu?.erreur?.code === 'AUCUNE_QUANTITE_A_RECEPTIONNER',
    String(receptionDouble.contenu?.erreur?.code ?? receptionDouble.statut)
  );

  const apresDestCommande = await appel(
    `/pharmacie/stocks/valorisation?pointId=${destinationCommande.id}&recherche=${encodeURIComponent(produitCommande.produitCode)}&limite=100&t=${Date.now()}`,
    { headers: entetes }
  );
  const qteApresDestCommande =
    (apresDestCommande.contenu?.donnees?.donnees ?? []).find(
      (ligne) => ligne.produitId === produitCommande.produitId
    )?.quantite ?? 0;
  verifier(
    'ravitaillement depuis commande : pharmacie creditee',
    qteApresDestCommande === qteAvantDestCommande + 2,
    `${qteAvantDestCommande} -> ${qteApresDestCommande}`
  );
} else {
  verifier('ravitaillement depuis commande : prerequis disponibles', false);
}

// --- Commande aux firmes + reception dans le magasin ------------------------
const fournisseurs = await appel('/pharmacie/fournisseurs?typeFournisseur=EXTERNE', { headers: entetes });
const fournisseur = (fournisseurs.contenu?.donnees ?? [])[0];
verifier('fournisseur externe disponible', Boolean(fournisseur?.id));

if (fournisseur && produit) {
  const commande = await appel('/pharmacie/magasin/commander', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      fournisseurId: fournisseur.id,
      statut: 'ENVOYEE',
      lignes: [{ produitId: produit.produitId, quantiteCommandee: 5, prixUnitaire: 1000 }],
    }),
  });
  verifier(
    'commande aux firmes pour le magasin',
    commande.statut === 201,
    String(commande.contenu?.erreur?.code ?? commande.statut)
  );
  const commandeId = commande.contenu?.donnees?.id;
  verifier('commande : point = magasin', commande.contenu?.donnees?.pointId === magasinId);

  const detail = await appel(`/pharmacie/magasin/commandes/${commandeId}`, { headers: entetes });
  const ligne = detail.contenu?.donnees?.lignes?.[0];
  verifier('detail de commande du magasin', detail.statut === 200 && Boolean(ligne?.id));
  // Colonne « Point » du tableau : le nom du point doit accompagner la commande.
  verifier(
    'commande du magasin : nom du point expose',
    typeof detail.contenu?.donnees?.pointNom === 'string' && detail.contenu.donnees.pointNom.length > 0,
    detail.contenu?.donnees?.pointNom
  );

  const avantReception = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes })).contenu
    ?.donnees?.donnees?.find((l) => l.produitId === produit.produitId)?.quantite;

  const numeroFacture = `TEST-FACT-${Date.now()}`;
  // Facture du montant total de la commande (TVA comprise) : la validation doit
  // solder la commande.
  const montantFacture = Number(commande.contenu?.donnees?.totalTTC ?? 5000);
  const reception = await appel(`/pharmacie/magasin/commandes/${commandeId}/reception`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      // Facture fournisseur : montant et mode de reglement alimentent la tresorerie.
      numeroFacture,
      montantFacture,
      modePaiement: 'VIREMENT',
      commentaire: 'Reception de test : facture fournisseur',
      lignes: [
        {
          ligneId: ligne.id,
          quantiteRecue: 5,
          numeroLot: `TEST-MAG-${Date.now()}`,
          datePeremption: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        },
      ],
    }),
  });
  verifier(
    'reception dans le magasin',
    reception.statut === 200 && reception.contenu?.donnees?.statut === 'RECUE',
    reception.contenu?.donnees?.statut
  );

  const apresReception = (await appel('/pharmacie/magasin/stock?limite=100', { headers: entetes })).contenu
    ?.donnees?.donnees?.find((l) => l.produitId === produit.produitId)?.quantite;
  verifier(
    'reception : stock du magasin credite',
    (apresReception ?? 0) === (avantReception ?? 0) + 5,
    `${avantReception} -> ${apresReception}`
  );

  // Facture fournisseur : le montant saisi a la reception devient une DEMANDE de
  // reglement (EN_ATTENTE). Aucune ecriture de tresorerie n'est creee avant la
  // validation par l'administration.
  const apresReceptionCommande = await appel(`/pharmacie/magasin/commandes/${commandeId}`, {
    headers: entetes,
  });
  const commandeApresReception = apresReceptionCommande.contenu?.donnees ?? {};

  // Tracabilite : le recepteur de la commande est enregistre et expose.
  verifier(
    'reception : recepteur enregistre',
    Boolean(commandeApresReception.recepteurNom) &&
      Boolean(commandeApresReception.dateReception) &&
      (commandeApresReception.receptions ?? []).length > 0,
    `${commandeApresReception.recepteurNom ?? '-'} / ${commandeApresReception.dateReception ?? '-'}`
  );

  verifier(
    'commande : reglement en attente de validation',
    commandeApresReception.montantPaye === 0 &&
      commandeApresReception.montantEnAttente === montantFacture &&
      commandeApresReception.statutReglement === 'A_VALIDER',
    `${commandeApresReception.montantPaye} paye / ${commandeApresReception.montantEnAttente} en attente / ${commandeApresReception.statutReglement}`
  );

  // Aucune ecriture ACHAT tant que la demande n'est pas validee.
  const transactionsAvant = await appel(
    `/finances/transactions?categorie=ACHAT&sens=SORTIE&pointId=${magasinId}&limite=100`,
    { headers: entetes }
  );
  const ecritureAvant = (transactionsAvant.contenu?.donnees?.donnees ?? []).find(
    (flux) => flux.referenceId === commandeId
  );
  verifier(
    'validation : aucune ecriture avant validation',
    !ecritureAvant,
    ecritureAvant ? 'ecriture presente' : 'aucune ecriture'
  );

  // File d'attente de l'administration : la demande y figure.
  const fileAttente = await appel('/pharmacie/commandes/reglements/en-attente?limite=100', {
    headers: entetes,
  });
  const demande = (fileAttente.contenu?.donnees?.donnees ?? []).find(
    (reglementEnAttente) => reglementEnAttente.commandeId === commandeId
  );
  verifier(
    "file d'attente : demande de reglement presente",
    fileAttente.statut === 200 && Boolean(demande?.id) && demande.montant === montantFacture,
    `${demande?.montant} / ${demande?.statut ?? fileAttente.contenu?.erreur?.code}`
  );

  // Validation (DG, DGA, Comptable...) : c'est elle qui solde la commande et
  // cree l'ecriture SORTIE / ACHAT au grand livre.
  const validationReglement = await appel(
    `/pharmacie/commandes/${commandeId}/reglements/${demande.id}/valider`,
    { method: 'POST', headers: entetes }
  );
  const commandeValidee = validationReglement.contenu?.donnees ?? {};
  verifier(
    'reglement valide : commande soldee',
    validationReglement.statut === 200 &&
      commandeValidee.montantPaye === montantFacture &&
      commandeValidee.montantEnAttente === 0 &&
      commandeValidee.statutReglement === 'PAYEE',
    `${validationReglement.statut} / ${commandeValidee.montantPaye} paye / ${commandeValidee.statutReglement ?? validationReglement.contenu?.erreur?.code}`
  );

  const transactions = await appel(
    `/finances/transactions?categorie=ACHAT&sens=SORTIE&pointId=${magasinId}&limite=100`,
    { headers: entetes }
  );
  const ecriture = (transactions.contenu?.donnees?.donnees ?? []).find(
    (flux) => flux.referenceId === commandeId
  );
  verifier(
    'validation : ecriture de tresorerie ACHAT creee',
    transactions.statut === 200 &&
      ecriture?.montant === montantFacture &&
      ecriture?.mode === 'VIREMENT' &&
      String(ecriture?.libelle ?? '').includes(numeroFacture),
    `${ecriture?.montant} / ${ecriture?.mode} - ${ecriture?.libelle ?? transactions.contenu?.erreur?.code}`
  );

  // Un versement superieur au reste a payer est refuse.
  const tropPercu = await appel(`/pharmacie/magasin/commandes/${commandeId}/reglements`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ montant: 1000, mode: 'ESPECES' }),
  });
  verifier(
    'commande : trop-percu refuse',
    tropPercu.statut === 400 && tropPercu.contenu?.erreur?.code === 'REGLEMENT_EXCEDENT',
    `${tropPercu.statut} / ${tropPercu.contenu?.erreur?.code}`
  );
}

// --- Brouillon de commande du magasin : PATCH, validation, annulation -------
if (fournisseur && produit) {
  const brouillon = await appel('/pharmacie/magasin/commander', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      fournisseurId: fournisseur.id,
      statut: 'BROUILLON',
      lignes: [{ produitId: produit.produitId, quantiteCommandee: 2, prixUnitaire: 500 }],
    }),
  });
  const brouillonId = brouillon.contenu?.donnees?.id;
  verifier(
    'brouillon de commande du magasin cree',
    brouillon.statut === 201 && brouillon.contenu?.donnees?.statut === 'BROUILLON',
    String(brouillon.contenu?.erreur?.code ?? brouillon.statut)
  );

  // Un brouillon n'est pas encore engage aupres de la firme : pas de reglement.
  const reglementBrouillon = await appel(`/pharmacie/magasin/commandes/${brouillonId}/reglements`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ montant: 100, mode: 'ESPECES' }),
  });
  verifier(
    'commande : reglement refuse sur un brouillon',
    reglementBrouillon.statut === 409 &&
      reglementBrouillon.contenu?.erreur?.code === 'COMMANDE_NON_REGLABLE',
    `${reglementBrouillon.statut} / ${reglementBrouillon.contenu?.erreur?.code}`
  );

  const modification = await appel(`/pharmacie/magasin/commandes/${brouillonId}`, {
    method: 'PATCH',
    headers: entetes,
    body: JSON.stringify({
      commentaire: 'Brouillon de test',
      lignes: [{ produitId: produit.produitId, quantiteCommandee: 4, prixUnitaire: 750 }],
    }),
  });
  verifier(
    'brouillon du magasin modifie (PATCH)',
    modification.statut === 200 && modification.contenu?.donnees?.lignes?.[0]?.quantiteCommandee === 4,
    String(modification.contenu?.erreur?.code ?? modification.statut)
  );

  const validation = await appel(`/pharmacie/magasin/commandes/${brouillonId}`, {
    method: 'PATCH',
    headers: entetes,
    body: JSON.stringify({ statut: 'ENVOYEE' }),
  });
  verifier(
    'brouillon du magasin valide (ENVOYEE)',
    validation.statut === 200 && validation.contenu?.donnees?.statut === 'ENVOYEE',
    String(validation.contenu?.erreur?.code ?? validation.statut)
  );

  // Demande de reglement partielle : elle part en attente de validation.
  const paiementPartiel = await appel(`/pharmacie/magasin/commandes/${brouillonId}/reglements`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ montant: 100, mode: 'ESPECES' }),
  });
  const demandePartielle = (paiementPartiel.contenu?.donnees?.reglements ?? []).find(
    (ligneReglement) => ligneReglement.statut === 'EN_ATTENTE'
  );
  verifier(
    'commande : demande de paiement partiel (a valider)',
    paiementPartiel.statut === 201 &&
      paiementPartiel.contenu?.donnees?.statutReglement === 'A_VALIDER' &&
      Boolean(demandePartielle?.id),
    `${paiementPartiel.contenu?.donnees?.statutReglement} / ${demandePartielle?.montant ?? paiementPartiel.contenu?.erreur?.code}`
  );

  // Validation de la demande : la commande devient partiellement payee.
  if (demandePartielle) {
    const validationPartielle = await appel(
      `/pharmacie/commandes/${brouillonId}/reglements/${demandePartielle.id}/valider`,
      { method: 'POST', headers: entetes }
    );
    verifier(
      'commande : paiement partiel valide (statut PARTIELLE)',
      validationPartielle.statut === 200 &&
        validationPartielle.contenu?.donnees?.statutReglement === 'PARTIELLE' &&
        validationPartielle.contenu?.donnees?.montantPaye === 100,
      `${validationPartielle.contenu?.donnees?.statutReglement} / ${validationPartielle.contenu?.donnees?.montantPaye ?? validationPartielle.contenu?.erreur?.code}`
    );
  }

  // Rejet d'une demande : aucune ecriture, la commande repasse sans attente.
  const demandeRejet = await appel(`/pharmacie/magasin/commandes/${brouillonId}/reglements`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ montant: 50, mode: 'ESPECES' }),
  });
  const aRejeter = (demandeRejet.contenu?.donnees?.reglements ?? []).find(
    (ligneReglement) => ligneReglement.statut === 'EN_ATTENTE'
  );
  if (aRejeter) {
    const rejet = await appel(
      `/pharmacie/commandes/${brouillonId}/reglements/${aRejeter.id}/rejeter`,
      { method: 'POST', headers: entetes, body: JSON.stringify({ motif: 'Rejet de test' }) }
    );
    verifier(
      'commande : demande rejetee (aucun paiement)',
      rejet.statut === 200 &&
        rejet.contenu?.donnees?.montantEnAttente === 0 &&
        rejet.contenu?.donnees?.montantPaye === 100,
      `${rejet.contenu?.donnees?.montantPaye} paye / ${rejet.contenu?.donnees?.montantEnAttente ?? rejet.contenu?.erreur?.code} en attente`
    );
  }

  const annulation = await appel(`/pharmacie/magasin/commandes/${brouillonId}`, {
    method: 'PATCH',
    headers: entetes,
    body: JSON.stringify({ statut: 'ANNULEE' }),
  });
  verifier(
    'commande du magasin annulee (ANNULEE)',
    annulation.statut === 200 && annulation.contenu?.donnees?.statut === 'ANNULEE',
    String(annulation.contenu?.erreur?.code ?? annulation.statut)
  );
}

// --- Paiement a la commande : demande de reglement immediate ----------------
if (fournisseur && produit) {
  const commandePayee = await appel('/pharmacie/magasin/commander', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      fournisseurId: fournisseur.id,
      statut: 'ENVOYEE',
      lignes: [{ produitId: produit.produitId, quantiteCommandee: 2, prixUnitaire: 750 }],
    }),
  });
  const commandePayeeId = commandePayee.contenu?.donnees?.id;

  // Comme le formulaire de commande : la commande est validee, PUIS la demande de
  // reglement (tout ou partie du montant estime) est creee.
  const versement = await appel(`/pharmacie/magasin/commandes/${commandePayeeId}/reglements`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ montant: 500, mode: 'MOBILE_MONEY', reference: 'ACOMPTE-1' }),
  });
  const apresVersement = versement.contenu?.donnees ?? {};
  verifier(
    'paiement a la commande : demande creee (a valider)',
    commandePayee.statut === 201 &&
      versement.statut === 201 &&
      apresVersement.montantPaye === 0 &&
      apresVersement.montantEnAttente === 500 &&
      apresVersement.statutReglement === 'A_VALIDER',
    `${apresVersement.montantEnAttente} en attente / ${apresVersement.statutReglement ?? versement.contenu?.erreur?.code}`
  );

  const acompteDemande = (apresVersement.reglements ?? []).find(
    (ligneReglement) => ligneReglement.statut === 'EN_ATTENTE'
  );
  if (acompteDemande) {
    const validationAcompte = await appel(
      `/pharmacie/commandes/${commandePayeeId}/reglements/${acompteDemande.id}/valider`,
      { method: 'POST', headers: entetes }
    );
    verifier(
      'paiement a la commande : acompte valide (paiement partiel)',
      validationAcompte.statut === 200 &&
        validationAcompte.contenu?.donnees?.montantPaye === 500 &&
        validationAcompte.contenu?.donnees?.statutReglement === 'PARTIELLE',
      `${validationAcompte.contenu?.donnees?.montantPaye} paye / ${validationAcompte.contenu?.donnees?.statutReglement ?? validationAcompte.contenu?.erreur?.code}`
    );
  }
}

// --- Controle d'acces --------------------------------------------------------
const jetonPpv = await connexion('demo.ppv@agro-expertise.com', 'Demo@2026');
if (jetonPpv) {
  const refus = await appel('/pharmacie/magasin', { headers: { Authorization: `Bearer ${jetonPpv}` } });
  verifier('magasin : acces refuse a un PPV (403)', refus.statut === 403, String(refus.statut));
}

const echecs = resultats.filter((resultat) => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} verifications reussies.`);

serveur.close();
await fermerPool();
process.exit(echecs.length > 0 ? 1 : 0);