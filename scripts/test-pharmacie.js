// Test de fumee du module Pharmacie.
// Demarre l'API en memoire, se connecte avec le compte super administrateur
// et enchaine les appels cles (points, produits, stocks, vente, finance).
// Usage : node scripts/test-pharmacie.js

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

const connexion = await appel('/auth/connexion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@agro-expertise.com', motDePasse: 'Admin@2026' }),
});
verifier('connexion', connexion.statut === 200, String(connexion.statut));
const jeton = connexion.contenu?.donnees?.jetonAcces;
const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };

const points = await appel('/pharmacie/points', { headers: entetes });
verifier('points de vente', points.statut === 200 && points.contenu.donnees.length > 0, `${points.contenu?.donnees?.length}`);
const pointId = points.contenu?.donnees?.[0]?.id;

const produits = await appel('/pharmacie/produits', { headers: entetes });
verifier('produits', produits.statut === 200, `${produits.contenu?.donnees?.donnees?.length}`);

const valorisation = await appel('/pharmacie/stocks/valorisation', { headers: entetes });
verifier(
  'valorisation stock (paginee)',
  valorisation.statut === 200 && Array.isArray(valorisation.contenu?.donnees?.donnees),
  `${valorisation.contenu?.donnees?.donnees?.length} ligne(s) / ${valorisation.contenu?.donnees?.pagination?.total}`
);

const alertes = await appel('/pharmacie/stocks/alertes', { headers: entetes });
verifier(
  'alertes stock (paginees)',
  alertes.statut === 200 && Array.isArray(alertes.contenu?.donnees?.donnees),
  `${alertes.contenu?.donnees?.donnees?.length} alerte(s) / ${alertes.contenu?.donnees?.pagination?.total}`
);

const catalogue = await appel(`/pharmacie/stocks/catalogue?pointId=${pointId}`, { headers: entetes });
verifier('catalogue point', catalogue.statut === 200 && catalogue.contenu.donnees.length > 0, `${catalogue.contenu?.donnees?.length}`);

const valoPage2 = await appel('/pharmacie/stocks/valorisation?limite=5&page=2', { headers: entetes });
verifier(
  'valorisation : pagination (page 2 / limite 5)',
  valoPage2.statut === 200 &&
    valoPage2.contenu?.donnees?.pagination?.page === 2 &&
    valoPage2.contenu?.donnees?.pagination?.limite === 5,
  `page ${valoPage2.contenu?.donnees?.pagination?.page} / ${valoPage2.contenu?.donnees?.pagination?.totalPages}`
);

// Totaux de valorisation : calcules sur tout le filtre, pas sur la page affichee.
const totauxValorisation = valorisation.contenu?.donnees?.totaux;
verifier(
  'valorisation : totaux globaux exposes',
  typeof totauxValorisation?.produitsDisponibles === 'number' &&
    typeof totauxValorisation?.quantite === 'number' &&
    typeof totauxValorisation?.valeurAchat === 'number' &&
    typeof totauxValorisation?.valeurVente === 'number' &&
    totauxValorisation.produitsDisponibles >= 0 &&
    // Les produits disponibles sont un sous-ensemble des produits listes.
    totauxValorisation.produitsDisponibles <= (valorisation.contenu?.donnees?.pagination?.total ?? 0) &&
    totauxValorisation.valeurAchat >= 0 &&
    totauxValorisation.valeurVente >= 0,
  `${totauxValorisation?.produitsDisponibles} disponible(s) / ${totauxValorisation?.quantite} unite(s) / ${totauxValorisation?.valeurAchat} / ${totauxValorisation?.valeurVente}`
);

const totauxValorisationPage2 = valoPage2.contenu?.donnees?.totaux;
verifier(
  'valorisation : totaux independants de la page',
  Boolean(totauxValorisation) &&
    totauxValorisationPage2?.quantite === totauxValorisation?.quantite &&
    totauxValorisationPage2?.valeurAchat === totauxValorisation?.valeurAchat &&
    totauxValorisationPage2?.valeurVente === totauxValorisation?.valeurVente,
  `${totauxValorisationPage2?.valeurAchat} / ${totauxValorisation?.valeurAchat}`
);

const alerteLimite = await appel('/pharmacie/stocks/alertes?limite=1', { headers: entetes });
verifier(
  'alertes : pagination (limite 1)',
  alerteLimite.statut === 200 &&
    alerteLimite.contenu?.donnees?.pagination?.limite === 1 &&
    (alerteLimite.contenu?.donnees?.donnees?.length ?? 0) <= 1,
  `${alerteLimite.contenu?.donnees?.donnees?.length} ligne(s) / ${alerteLimite.contenu?.donnees?.pagination?.total}`
);

const produit = catalogue.contenu?.donnees?.find((element) => element.quantite > 10);
if (produit) {
  // Vente comptant : paiement complet par defaut, aucune monnaie a rendre.
  const vente = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ pointId, lignes: [{ produitId: produit.id, quantite: 2 }] }),
  });
  verifier('creation vente', vente.statut === 201, `${vente.contenu?.donnees?.numero ?? vente.contenu?.erreur?.message}`);
  verifier(
    'vente comptant : soldee, sans rendu',
    vente.contenu?.donnees?.statutPaiement === 'SOLDE' && vente.contenu?.donnees?.montantRendu === 0,
    `rendu ${vente.contenu?.donnees?.montantRendu} / ${vente.contenu?.donnees?.statutPaiement}`
  );

  // Vente comptant avec montant recu superieur au total : la monnaie est rendue.
  const totalConnu = Number(vente.contenu?.donnees?.totalTTC ?? 0);
  const venteRendu = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointId,
      lignes: [{ produitId: produit.id, quantite: 2 }],
      montantRecu: totalConnu + 1000,
    }),
  });
  verifier(
    'vente comptant : montant rendu calcule',
    venteRendu.statut === 201 && venteRendu.contenu?.donnees?.montantRendu === 1000,
    `rendu ${venteRendu.contenu?.donnees?.montantRendu}`
  );

  // Le catalogue expose le taux de TVA : sans lui, le total affiche au comptoir
  // (HT) serait inferieur au TTC du serveur et la vente serait vue comme un credit.
  verifier(
    'catalogue : taux de TVA expose',
    typeof produit.tvaTaux === 'number',
    `TVA ${produit.tvaTaux}%`
  );

  const arrondiTest = (valeur) => Math.round(valeur * 100) / 100;
  const baseTtc = arrondiTest(produit.prixVente * 2);
  const totalTtcFront = arrondiTest(baseTtc + arrondiTest((baseTtc * produit.tvaTaux) / 100));

  const venteTtc = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointId,
      lignes: [{ produitId: produit.id, quantite: 2 }],
      paiement: { mode: 'ESPECES', montant: totalTtcFront },
      montantRecu: totalTtcFront + 2000,
    }),
  });
  verifier(
    'vente : total TTC (TVA incluse) identique au serveur',
    venteTtc.statut === 201 &&
      venteTtc.contenu?.donnees?.totalTTC === totalTtcFront &&
      venteTtc.contenu?.donnees?.statutPaiement === 'SOLDE',
    `serveur ${venteTtc.contenu?.donnees?.totalTTC} / front ${totalTtcFront} ${venteTtc.contenu?.erreur?.message ?? ''}`
  );
  verifier(
    'vente : monnaie rendue sur un total TTC',
    venteTtc.contenu?.donnees?.montantRendu === 2000,
    `rendu ${venteTtc.contenu?.donnees?.montantRendu}`
  );

  // Vente a credit sans client identifie : refusee.
  const creditSansClient = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointId,
      lignes: [{ produitId: produit.id, quantite: 1 }],
      paiement: { mode: 'ESPECES', montant: 0 },
    }),
  });
  verifier(
    'vente a credit sans client refusee (400)',
    creditSansClient.statut === 400,
    `${creditSansClient.statut} ${creditSansClient.contenu?.erreur?.code}`
  );

  // Vente a credit avec client (nom + telephone) et acompte.
  const clientCredit = `Client Credit ${Date.now()}`;
  const credit = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointId,
      client: { nom: clientCredit, telephone: '+228 90 55 44 33' },
      lignes: [{ produitId: produit.id, quantite: 2 }],
      paiement: { mode: 'ESPECES', montant: 500 },
      montantRecu: 500,
    }),
  });
  const venteCredit = credit.contenu?.donnees;
  verifier(
    'vente a credit acceptee avec client identifie',
    credit.statut === 201 && venteCredit?.statutPaiement === 'CREDIT' && venteCredit?.resteAPayer > 0,
    `${venteCredit?.numero} reste ${venteCredit?.resteAPayer}`
  );
  verifier(
    'vente a credit : client (nom + telephone) conserve',
    venteCredit?.client?.nom === clientCredit && venteCredit?.client?.telephone === '+228 90 55 44 33'
  );

  // Le client apparait dans les debiteurs, trie par montant du.
  const creances = await appel('/pharmacie/clients/creances?ordre=montant', { headers: entetes });
  const debiteur = (creances.contenu?.donnees ?? []).find((element) => element.nom === clientCredit);
  verifier(
    'clients debiteurs : client en credit present',
    creances.statut === 200 && Boolean(debiteur) && debiteur?.montantDu === venteCredit?.resteAPayer,
    `${creances.contenu?.donnees?.length} debiteur(s)`
  );

  // Encaissement du solde : la vente devient soldee.
  if (venteCredit?.id) {
    const solde = await appel(`/pharmacie/ventes/${venteCredit.id}/paiements`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({ mode: 'MOBILE_MONEY', montant: venteCredit.resteAPayer }),
    });
    verifier(
      'encaissement du solde : vente soldee',
      solde.statut === 200 && solde.contenu?.donnees?.statutPaiement === 'SOLDE',
      `reste ${solde.contenu?.donnees?.resteAPayer}`
    );

    const creancesApres = await appel('/pharmacie/clients/creances', { headers: entetes });
    const encoreDebiteur = (creancesApres.contenu?.donnees ?? []).some((element) => element.nom === clientCredit);
    verifier('clients debiteurs : client retire apres solde', encoreDebiteur === false);
  }
}

const tableau = await appel('/pharmacie/tableau-de-bord', { headers: entetes });
verifier('tableau de bord pharmacie', tableau.statut === 200, JSON.stringify(tableau.contenu?.donnees?.compteurs));

const finance = await appel('/pharmacie/finance/indicateurs', { headers: entetes });
verifier('finance pharmacie', finance.statut === 200, JSON.stringify(finance.contenu?.donnees?.synthese));

const direction = await appel('/direction/tableau-de-bord', { headers: entetes });
verifier('dashboard direction', direction.statut === 200, JSON.stringify(direction.contenu?.donnees?.financeConsolidee));

// Fournisseurs + commande + reception
const fournisseurs = await appel('/pharmacie/fournisseurs', { headers: entetes });
const fournisseurId = fournisseurs.contenu?.donnees?.[0]?.id;
const produitId = produits.contenu?.donnees?.donnees?.[0]?.id;

if (fournisseurId && produitId) {
  const commande = await appel('/pharmacie/commandes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      pointId,
      fournisseurId,
      lignes: [{ produitId, quantiteCommandee: 5, prixUnitaire: 1000 }],
    }),
  });
  verifier('creation commande', commande.statut === 201, commande.contenu?.donnees?.numero);
  const commandeId = commande.contenu?.donnees?.id;

  const detailCommande = await appel(`/pharmacie/commandes/${commandeId}`, { headers: entetes });
  const lignesReception = (detailCommande.contenu?.donnees?.lignes ?? []).map((ligne) => ({
    ligneId: ligne.id,
    quantiteRecue: ligne.quantiteCommandee - ligne.quantiteRecue,
  }));
  const reception = await appel(`/pharmacie/commandes/${commandeId}/reception`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ lignes: lignesReception }),
  });
  verifier('reception commande', reception.statut === 200, reception.contenu?.donnees?.statut);
}

// Inventaire : ouverture, comptage sans ecart puis validation
const inventaire = await appel('/pharmacie/inventaires', {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({ pointId, libelle: 'Inventaire de test' }),
});
verifier('ouverture inventaire', inventaire.statut === 201, inventaire.contenu?.donnees?.numero);
const inventaireId = inventaire.contenu?.donnees?.id;

const detailInventaire = await appel(`/pharmacie/inventaires/${inventaireId}`, { headers: entetes });
const lignesComptage = (detailInventaire.contenu?.donnees?.lignes ?? []).map((ligne) => ({
  ligneId: ligne.id,
  quantitePhysique: ligne.quantiteTheorique,
}));
const comptage = await appel(`/pharmacie/inventaires/${inventaireId}/comptage`, {
  method: 'PUT',
  headers: entetes,
  body: JSON.stringify({ lignes: lignesComptage }),
});
verifier('comptage inventaire', comptage.statut === 200);
const validation = await appel(`/pharmacie/inventaires/${inventaireId}/valider`, {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({}),
});
verifier('validation inventaire', validation.statut === 200, validation.contenu?.donnees?.statut);

// Clients : creation, liste et classement
const clientCree = await appel('/pharmacie/clients', {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({
    nom: 'Client Test',
    telephone: '+228 90 11 22 33',
    email: 'client.test@example.com',
    adresse: 'Lome',
  }),
});
verifier('creation client', clientCree.statut === 201, clientCree.contenu?.donnees?.nom);
const clientId = clientCree.contenu?.donnees?.id;

const listeClients = await appel('/pharmacie/clients', { headers: entetes });
verifier('liste clients', listeClients.statut === 200 && listeClients.contenu.donnees.length > 0, `${listeClients.contenu?.donnees?.length}`);

const topClients = await appel('/pharmacie/clients/top?limite=10', { headers: entetes });
verifier('top clients', topClients.statut === 200);

// Vente rattachee a un client existant
if (produit && clientId) {
  const venteClient = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ pointId, clientId, lignes: [{ produitId: produit.id, quantite: 1 }] }),
  });
  verifier('vente avec client', venteClient.statut === 201, venteClient.contenu?.donnees?.clientNom);
}

// Parametres publics + retours de vente
const parametresPublics = await appel('/parametres/publics', { headers: entetes });
verifier(
  'parametres publics : retours actifs',
  parametresPublics.statut === 200 && parametresPublics.contenu?.donnees?.['pharmacie.retours.actif'] === true,
  JSON.stringify(parametresPublics.contenu?.donnees)
);

if (produit) {
  const venteRetour = await appel('/pharmacie/ventes', {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({ pointId, lignes: [{ produitId: produit.id, quantite: 2 }] }),
  });
  const venteRetourId = venteRetour.contenu?.donnees?.id;
  const ligneRetour = venteRetour.contenu?.donnees?.lignes?.[0];
  verifier('vente support de retour', venteRetour.statut === 201 && Boolean(ligneRetour), venteRetour.contenu?.donnees?.numero);

  if (ligneRetour) {
    const retour = await appel(`/pharmacie/ventes/${venteRetourId}/retours`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({ motif: 'Retour de test', lignes: [{ ligneId: ligneRetour.id, quantite: 1 }] }),
    });
    verifier(
      'retour de vente : montant retourne',
      retour.statut === 200 && (retour.contenu?.donnees?.montantRetourne ?? 0) > 0,
      `montantRetourne ${retour.contenu?.donnees?.montantRetourne}`
    );
    verifier(
      'retour de vente : quantite reintegree',
      (retour.contenu?.donnees?.lignes?.[0]?.quantiteRetournee ?? 0) === 1,
      `quantiteRetournee ${retour.contenu?.donnees?.lignes?.[0]?.quantiteRetournee}`
    );

    const depassement = await appel(`/pharmacie/ventes/${venteRetourId}/retours`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({ lignes: [{ ligneId: ligneRetour.id, quantite: 5 }] }),
    });
    verifier('retour au-dela du restant : refuse (400)', depassement.statut === 400, String(depassement.statut));

    // Remboursement desactive : un retour qui genererait un remboursement est refuse.
    const desactivation = await appel('/parametres/pharmacie.retours.remboursement.actif', {
      method: 'PUT',
      headers: entetes,
      body: JSON.stringify({ valeur: false }),
    });
    if (desactivation.statut === 200) {
      const refundRefuse = await appel(`/pharmacie/ventes/${venteRetourId}/retours`, {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify({ lignes: [{ ligneId: ligneRetour.id, quantite: 1 }] }),
      });
      verifier(
        'remboursement desactive : retour rembourse refuse (409)',
        refundRefuse.statut === 409,
        String(refundRefuse.statut)
      );
      await appel('/parametres/pharmacie.retours.remboursement.actif', {
        method: 'PUT',
        headers: entetes,
        body: JSON.stringify({ valeur: true }),
      });
    }
  }
}

// Referentiels produits (categories / unites / rayons)
const refs = await appel('/pharmacie/referentiels?type=CATEGORIE', { headers: entetes });
verifier('referentiels : categories semees', refs.statut === 200 && refs.contenu.donnees.length > 0, `${refs.contenu?.donnees?.length}`);

const suffixeRef = Date.now().toString().slice(-6);
const creationRef = await appel('/pharmacie/referentiels', {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({ type: 'CATEGORIE', libelle: 'Categorie de test' }),
});
verifier(
  'referentiel : creation avec code auto-genere',
  creationRef.statut === 201 && /^CAT[0-9]{3}$/.test(creationRef.contenu?.donnees?.code ?? ''),
  creationRef.contenu?.donnees?.code
);
const refId = creationRef.contenu?.donnees?.id;
const refCode = creationRef.contenu?.donnees?.code;

const modifRef = await appel(`/pharmacie/referentiels/${refId}`, {
  method: 'PATCH',
  headers: entetes,
  body: JSON.stringify({ libelle: 'Categorie de test (modifiee)' }),
});
verifier('referentiel : modification', modifRef.statut === 200 && modifRef.contenu.donnees.libelle.includes('modifiee'));

// Produit utilisant la categorie generee et un rayon seme
const rayonSeme = (await appel('/pharmacie/referentiels?type=RAYON', { headers: entetes })).contenu.donnees[0];
const produitRef = await appel('/pharmacie/produits', {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({ code: `REF_${suffixeRef}`, nomCommercial: 'Produit ref.', categorie: refCode, rayon: rayonSeme.code }),
});
verifier(
  'produit : categorie et rayon dynamiques',
  produitRef.statut === 201 && produitRef.contenu?.donnees?.rayon === rayonSeme.code,
  produitRef.contenu?.donnees?.rayon
);

const suppressionUtilisee = await appel(`/pharmacie/referentiels/${refId}`, { method: 'DELETE', headers: entetes });
verifier('referentiel utilise : suppression refusee (409)', suppressionUtilisee.statut === 409, String(suppressionUtilisee.statut));

const catLibre = await appel('/pharmacie/referentiels', {
  method: 'POST',
  headers: entetes,
  body: JSON.stringify({ type: 'CATEGORIE', libelle: 'Categorie libre' }),
});
const suppressionLibre = await appel(`/pharmacie/referentiels/${catLibre.contenu?.donnees?.id}`, {
  method: 'DELETE',
  headers: entetes,
});
verifier('referentiel inutilise : suppression', suppressionLibre.statut === 200, String(suppressionLibre.statut));

const echecs = resultats.filter((resultat) => !resultat.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} verifications reussies.`);

serveur.close();
await fermerPool();
process.exit(echecs.length > 0 ? 1 : 0);