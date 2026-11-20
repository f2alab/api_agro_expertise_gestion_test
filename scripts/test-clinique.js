// Test de fumee du module Clinique.
// Deroule le parcours complet : accueil (frais de consultation), examen clinique,
// diagnostic, examen paraclinique, ordonnance, facture globale, dossier medical.
// Usage : node scripts/test-clinique.js
// Prerequis : base initialisee (npm run db:reset).

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
if (!jeton) {
  await fermerPool();
  process.exit(1);
}

const corps = (donnees) => ({ headers: entetes, body: JSON.stringify(donnees) });
const lire = (chemin) => appel(chemin, { headers: entetes });
const poster = (chemin, donnees) => appel(chemin, { method: 'POST', ...corps(donnees) });
const patch = (chemin, donnees) => appel(chemin, { method: 'PATCH', ...corps(donnees) });

// --- 1. Referentiels ---------------------------------------------------------
const referentiels = await lire('/clinique/referentiels?type=ESPECE');
verifier(
  'referentiels : especes seedees',
  referentiels.statut === 200 &&
    Array.isArray(referentiels.contenu?.donnees) &&
    referentiels.contenu.donnees.length > 0,
  `statut ${referentiels.statut}`
);

// --- 2. Proprietaire + animal ------------------------------------------------
const proprietaire = await poster('/clinique/proprietaires', {
  nom: 'Eleveur Test Clinique',
  telephone: '+228 90 00 00 00',
  typeProprietaire: 'ELEVEUR',
});
verifier(
  'creation proprietaire',
  proprietaire.statut === 201 && Boolean(proprietaire.contenu?.donnees?.id),
  `statut ${proprietaire.statut}`
);
const proprietaireId = proprietaire.contenu?.donnees?.id;

const animal = await poster('/clinique/animaux', {
  proprietaireId,
  nom: 'Biquette Test',
  espece: 'CAPRIN',
  sexe: 'F',
  poidsKg: 32,
});
verifier(
  'creation animal',
  animal.statut === 201 && Boolean(animal.contenu?.donnees?.id),
  `statut ${animal.statut}`
);
const animalId = animal.contenu?.donnees?.id;

// --- 3. Accueil : enregistrement + paiement des frais ------------------------
const accueil = await poster('/clinique/consultations/accueil', {
  proprietaireId,
  animalId,
  motif: 'Fievre et anorexie depuis deux jours',
  typeConsultation: 'CONSULTATION',
  paiement: { paye: true, mode: 'ESPECES' },
});
const consultation = accueil.contenu?.donnees;
verifier(
  'accueil consultation',
  accueil.statut === 201 && Boolean(consultation?.id),
  `statut ${accueil.statut}`
);
verifier(
  'frais de consultation encaisses (5 000 F par defaut)',
  consultation?.fraisPayes === true && consultation?.fraisConsultation === 5000,
  `${consultation?.fraisConsultation} F`
);
const consultationId = consultation?.id;

// --- 4. Salle de consultation : examens + diagnostic -------------------------
const examenDistance = await poster(`/clinique/consultations/${consultationId}/examens`, {
  typeExamen: 'DISTANCE',
  etatGeneral: 'MOYEN',
  comportement: 'PROSTRE',
  attitude: 'COUCHE',
  embonpoint: 3,
  signesExterieurs: 'Poil pique, muqueuses legerement congestionnees.',
});
verifier('examen a distance', examenDistance.statut === 200, `statut ${examenDistance.statut}`);

const examenRapproche = await poster(`/clinique/consultations/${consultationId}/examens`, {
  typeExamen: 'RAPPROCHE',
  temperatureC: 40.2,
  frequenceCardiaque: 96,
  frequenceRespiratoire: 28,
  tempsRecolorationCapillaireS: 2.5,
  muqueuses: 'HYPEREMIEES',
  pliCutane: 'NORMAL',
  scoreDouleur: 2,
  organes: [
    { organe: 'DIGESTIF', etat: 'ANORMAL', observation: 'Ballonnement modere' },
    { organe: 'RESPIRATOIRE', etat: 'NORMAL' },
  ],
});
verifier(
  'examen rapproche + organes',
  examenRapproche.statut === 200 &&
    examenRapproche.contenu?.donnees?.examens?.organes?.length === 2,
  `statut ${examenRapproche.statut}`
);

const diagnostic = await poster(`/clinique/consultations/${consultationId}/diagnostics`, {
  libelle: 'Enterite parasitaire presumee',
  certitude: 'PRESOMPTIF',
  gravite: 'MODEREE',
});
verifier('pose du diagnostic', diagnostic.statut === 201, `statut ${diagnostic.statut}`);

// --- 5. Examen paraclinique --------------------------------------------------
const paraclinique = await poster('/clinique/paracliniques', {
  consultationId,
  typeExamen: 'ANALYSE_LABO',
  libelle: 'Coprologie + numeration formule sanguine',
  indication: 'Confirmer la suspicion parasitaire',
  montant: 7500,
});
const examenParaId = paraclinique.contenu?.donnees?.id;
verifier(
  'demande paraclinique',
  paraclinique.statut === 201 && Boolean(examenParaId),
  `statut ${paraclinique.statut}`
);

const demarrage = await poster(`/clinique/paracliniques/${examenParaId}/demarrer`, {});
verifier('demarrage paraclinique', demarrage.statut === 200, `statut ${demarrage.statut}`);

const resultat = await poster(`/clinique/paracliniques/${examenParaId}/resultat`, {
  resultat: 'Oeufs de strongles en grand nombre.',
  conclusion: 'Parasitisme digestif confirme.',
  paye: true,
});
verifier(
  'resultat paraclinique + encaissement',
  resultat.statut === 200 && resultat.contenu?.donnees?.paye === true,
  `statut ${resultat.statut}`
);

const validation = await poster(`/clinique/paracliniques/${examenParaId}/valider`, {});
verifier(
  'validation paraclinique',
  validation.statut === 200 && validation.contenu?.donnees?.statut === 'VALIDE',
  `statut ${validation.statut}`
);

// --- 5 bis. Etapes du parcours (boutons de la fiche de consultation) --------
// Les boutons « Passer en paraclinique », « Resultats recus » et « Etape
// ordonnance » postent le nouveau statut sur /statut. La requete reutilise le
// meme parametre en affectation et en comparaison : sans cast explicite,
// PostgreSQL refuse l'execution (42P08 « types incoherents pour $2 »).
for (const etape of ['EN_CONSULTATION', 'EXAMEN_PARACLINIQUE', 'RESULTATS', 'ORDONNANCE']) {
  const changement = await poster(`/clinique/consultations/${consultationId}/statut`, {
    statut: etape,
  });
  verifier(
    `changement d etape ${etape}`,
    changement.statut === 200 && changement.contenu?.donnees?.statut === etape,
    `statut ${changement.statut}`
  );
}

// Le passage en salle de consultation pose l'heure de debut du dossier.
const apresDemarrage = await lire(`/clinique/consultations/${consultationId}`);
verifier(
  'debut de consultation horodate',
  apresDemarrage.statut === 200 && Boolean(apresDemarrage.contenu?.donnees?.consultationDebut),
  `${apresDemarrage.contenu?.donnees?.consultationDebut ?? '-'}`
);

// --- 6. Ordonnance ----------------------------------------------------------
const produits = await lire('/pharmacie/produits?limite=5');
const listeProduits = Array.isArray(produits.contenu?.donnees)
  ? produits.contenu.donnees
  : produits.contenu?.donnees?.donnees ?? [];
verifier(
  'produits pharmacie disponibles pour prescription',
  listeProduits.length > 0,
  `${listeProduits.length} produit(s)`
);

let ordonnanceId = null;
if (listeProduits.length > 0) {
  // Deux profils medicaux : l'Assistant veterinaire propose, le Docteur
  // veterinaire approuve. Les comptes de demonstration portent les roles
  // ASSISTANT_VETERINAIRE et VETERINAIRE.
  const jetonAssistant = await connexion(
    'demo.assistant.veto@agro-expertise.com',
    'Demo@2026'
  );
  const jetonDocteur = await connexion('demo.veto@agro-expertise.com', 'Demo@2026');
  verifier('connexion assistant veterinaire', Boolean(jetonAssistant));
  verifier('connexion docteur veterinaire', Boolean(jetonDocteur));

  const posterAssistant = (chemin, donnees) =>
    appel(chemin, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jetonAssistant}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(donnees),
    });
  const posterDocteur = (chemin, donnees) =>
    appel(chemin, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jetonDocteur}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(donnees),
    });
  const patchDocteur = (chemin, donnees) =>
    appel(chemin, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${jetonDocteur}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(donnees),
    });

  const ordonnance = await posterAssistant('/clinique/ordonnances', {
    consultationId,
    instructions: 'Administrer selon la posologie indiquee.',
    lignes: [
      {
        produitId: listeProduits[0].id,
        quantite: 2,
        posologie: '1 ml / 10 kg en sous-cutanee',
        voie: 'SOUS_CUTANEE',
        dureeJours: 3,
      },
    ],
  });
  ordonnanceId = ordonnance.contenu?.donnees?.id;
  verifier(
    'creation ordonnance par l assistant',
    ordonnance.statut === 201 && Boolean(ordonnanceId),
    `statut ${ordonnance.statut}`
  );
  verifier(
    'ordonnance de l assistant creee comme proposition a approuver',
    ordonnance.contenu?.donnees?.statut === 'BROUILLON',
    `statut ${ordonnance.contenu?.donnees?.statut}`
  );

  // L'assistant ne peut ni approuver ni delivrer : separation des taches.
  const approbationRefusee = await posterAssistant(
    `/clinique/ordonnances/${ordonnanceId}/approuver`,
    {}
  );
  verifier(
    'approbation refusee a l assistant (403)',
    approbationRefusee.statut === 403,
    `statut ${approbationRefusee.statut}`
  );

  // Une proposition non approuvee ne doit pas entrer dans la file de la
  // pharmacie : elle n'est pas encore opposable.
  const aServirAvant = await lire('/clinique/ordonnances/a-servir');
  const dansFileAvant = (aServirAvant.contenu?.donnees ?? []).some(
    (element) => element.id === ordonnanceId
  );
  verifier(
    'proposition absente de la file de la pharmacie',
    aServirAvant.statut === 200 && !dansFileAvant,
    `statut ${aServirAvant.statut}, present=${dansFileAvant}`
  );

  // Delivrance refusee tant que le Docteur veterinaire n'a pas approuve.
  const delivranceRefusee = await posterDocteur(
    `/clinique/ordonnances/${ordonnanceId}/servir`,
    {}
  );
  verifier(
    'delivrance refusee sur proposition non approuvee',
    delivranceRefusee.statut === 409,
    `statut ${delivranceRefusee.statut}`
  );

  // Approbation par le Docteur veterinaire (tracabilite de l'acte).
  const approbation = await posterDocteur(`/clinique/ordonnances/${ordonnanceId}/approuver`, {});
  verifier(
    'approbation de la proposition par le docteur',
    approbation.statut === 200 && approbation.contenu?.donnees?.statut === 'EMISE',
    `statut ${approbation.statut}`
  );
  verifier(
    'approbation tracee (auteur et date)',
    Boolean(approbation.contenu?.donnees?.approuveParNom) &&
      Boolean(approbation.contenu?.donnees?.approuveLe),
    `${approbation.contenu?.donnees?.approuveParNom ?? '-'}`
  );
  verifier(
    'prescripteur et approbateur distincts (assistant puis docteur)',
    Boolean(approbation.contenu?.donnees?.emisParNom) &&
      approbation.contenu?.donnees?.emisParNom !== approbation.contenu?.donnees?.approuveParNom,
    `${approbation.contenu?.donnees?.emisParNom ?? '-'} -> ${
      approbation.contenu?.donnees?.approuveParNom ?? '-'
    }`
  );

  // Une fois approuvee, l'ordonnance n'est plus modifiable.
  const modificationRefusee = await patchDocteur(`/clinique/ordonnances/${ordonnanceId}`, {
    instructions: 'Modification apres approbation (doit etre refusee).',
  });
  verifier(
    'modification refusee apres approbation',
    modificationRefusee.statut === 409,
    `statut ${modificationRefusee.statut}`
  );

  const aServir = await lire('/clinique/ordonnances/a-servir');
  verifier(
    'ordonnance approuvee dans la file de la pharmacie',
    aServir.statut === 200 && aServir.contenu?.donnees?.some((element) => element.id === ordonnanceId),
    `statut ${aServir.statut}`
  );

  // La fiche de consultation doit remonter les produits prescrits et la trace
  // de l'approbation.
  const detailConsultation = await lire(`/clinique/consultations/${consultationId}`);
  const ordonnanceResume = (detailConsultation.contenu?.donnees?.ordonnances ?? [])[0];
  const produitsOrdonnance = ordonnanceResume?.lignes ?? [];
  verifier(
    'fiche de consultation : produits de l ordonnance',
    produitsOrdonnance.length > 0 && Boolean(produitsOrdonnance[0].designation),
    `${produitsOrdonnance.length} produit(s)`
  );
  verifier(
    'fiche de consultation : approbation visible',
    Boolean(ordonnanceResume?.approuveParNom) && Boolean(ordonnanceResume?.emisParNom),
    `${ordonnanceResume?.emisParNom ?? '-'} -> ${ordonnanceResume?.approuveParNom ?? '-'}`
  );

  // Le Docteur veterinaire engage directement sa propre prescription : elle est
  // creee approuvee, sans validation supplementaire. Elle est ensuite annulee
  // pour ne pas polluer la file de la pharmacie du scenario.
  const ordonnanceDocteur = await posterDocteur('/clinique/ordonnances', {
    consultationId,
    instructions: 'Prescription directe du docteur (auto-approuvee).',
    lignes: [{ produitId: listeProduits[0].id, quantite: 1, posologie: 'Selon le poids' }],
  });
  verifier(
    'ordonnance du docteur directement approuvee',
    ordonnanceDocteur.statut === 201 &&
      ordonnanceDocteur.contenu?.donnees?.statut === 'EMISE' &&
      Boolean(ordonnanceDocteur.contenu?.donnees?.approuveLe),
    `statut ${ordonnanceDocteur.contenu?.donnees?.statut ?? '-'}`
  );
  const annulationDocteur = await posterDocteur(
    `/clinique/ordonnances/${ordonnanceDocteur.contenu?.donnees?.id}/annuler`,
    { motif: 'Test : annulation apres auto-approbation.' }
  );
  verifier(
    'annulation de la prescription de test',
    annulationDocteur.statut === 200,
    `statut ${annulationDocteur.statut}`
  );
}

// --- 7. Facture globale (rubriques parametrables) ---------------------------
const apercu = await poster('/clinique/factures/apercu', {
  consultationId,
  inclureConsultation: true,
  inclureExamens: true,
  inclureOrdonnance: true,
  inclureAutres: true,
  montantAutres: 1000,
});
verifier(
  'apercu de facture',
  apercu.statut === 200 && apercu.contenu?.donnees?.montantTotal > 0,
  `total ${apercu.contenu?.donnees?.montantTotal}`
);

const facture = await poster('/clinique/factures', {
  consultationId,
  inclureConsultation: true,
  inclureExamens: true,
  inclureOrdonnance: true,
  inclureAutres: true,
  montantAutres: 1000,
  designationAutres: 'Pansement et antiseptique',
});
const factureGeneree = facture.contenu?.donnees;
verifier(
  'generation de la facture',
  facture.statut === 201 && Boolean(factureGeneree?.id),
  `statut ${facture.statut}`
);
verifier(
  'lignes de facture par rubrique',
  Array.isArray(factureGeneree?.lignes) && factureGeneree.lignes.length >= 3,
  `${factureGeneree?.lignes?.length} ligne(s)`
);

// Detail produit de l'ordonnance : le document imprime un tableau
// (designation, quantite, montant) avant le recapitulatif des rubriques.
const produitsFactures =
  (factureGeneree?.lignes ?? []).find((ligne) => ligne.rubrique === 'PRODUIT')?.produits ?? [];
verifier(
  'detail des produits prescrits sur la facture',
  produitsFactures.length > 0 &&
    Boolean(produitsFactures[0].designation) &&
    produitsFactures[0].quantite > 0,
  `${produitsFactures.length} produit(s)`
);

if (factureGeneree?.resteAPayer > 0) {
  const reglement = await poster(`/clinique/factures/${factureGeneree.id}/paiement`, {
    montant: factureGeneree.resteAPayer,
    mode: 'ESPECES',
  });
  verifier(
    'reglement de la facture',
    reglement.statut === 200 && reglement.contenu?.donnees?.statut === 'PAYEE',
    `statut ${reglement.statut}`
  );
}

// --- 7 bis. Délivrance de l'ordonnance par la pharmacie ---------------------
// Cas nominal : une vente créée avec `ordonnanceId` sert la prescription,
// rattache la vente à la consultation et passe l'ordonnance en « SERVIE ».
if (ordonnanceId && listeProduits.length > 0) {
  const points = await lire('/pharmacie/points');
  const point = (points.contenu?.donnees ?? [])[0];
  const catalogue = point
    ? await lire(`/pharmacie/stocks/catalogue?pointId=${point.id}`)
    : { statut: 0, contenu: null };
  const enStock = (catalogue.contenu?.donnees ?? []).find(
    (produit) => produit.id === listeProduits[0].id && produit.quantite >= 2
  );

  if (point && enStock) {
    const vente = await poster('/pharmacie/ventes', {
      pointId: point.id,
      typeVente: 'ORDONNANCE',
      ordonnanceId,
      lignes: [{ produitId: enStock.id, quantite: 2 }],
      paiement: { mode: 'ESPECES' },
    });
    verifier(
      'vente sur ordonnance creee',
      vente.statut === 201 && vente.contenu?.donnees?.ordonnanceId === ordonnanceId,
      `statut ${vente.statut}`
    );

    const ordonnanceServie = await lire(`/clinique/ordonnances/${ordonnanceId}`);
    verifier(
      'ordonnance servie par la vente',
      ordonnanceServie.contenu?.donnees?.statut === 'SERVIE',
      `statut ${ordonnanceServie.statut}`
    );
  } else {
    // Repli : aucun stock disponible dans cette base de test.
    const service = await poster(`/clinique/ordonnances/${ordonnanceId}/servir`, {});
    verifier(
      'ordonnance servie (repli sans stock)',
      service.statut === 200 && service.contenu?.donnees?.statut === 'SERVIE',
      `statut ${service.statut}`
    );
  }
}

// --- 8. Cloture + dossier medical -------------------------------------------
const cloture = await poster(`/clinique/consultations/${consultationId}/cloturer`, {
  conclusion: 'Enterite parasitaire traitee, animal en amelioration.',
  pronostic: 'FAVORABLE',
  recommandations: 'Revoir dans deux semaines.',
});
verifier(
  'cloture de la consultation',
  cloture.statut === 200 && cloture.contenu?.donnees?.statut === 'CLOTURE',
  `statut ${cloture.statut}`
);

// Un dossier cloture est fige : le changement d'etape est refuse...
const statutApresCloture = await poster(`/clinique/consultations/${consultationId}/statut`, {
  statut: 'EN_CONSULTATION',
});
verifier(
  'dossier cloture : changement d etape refuse (409)',
  statutApresCloture.statut === 409 &&
    statutApresCloture.contenu?.erreur?.code === 'CONSULTATION_CLOTUREE',
  `statut ${statutApresCloture.statut}`
);

// ... et la reprise du dossier passe par une reouverture explicite et tracee.
const reouverture = await poster(`/clinique/consultations/${consultationId}/rouvrir`, {
  motif: 'Resultat de laboratoire recu apres la cloture',
});
verifier(
  'reouverture explicite du dossier cloture',
  reouverture.statut === 200 && reouverture.contenu?.donnees?.statut === 'EN_CONSULTATION',
  `statut ${reouverture.statut}`
);

const dossier = await lire(`/clinique/animaux/${animalId}/dossier`);
verifier(
  'dossier medical complet',
  dossier.statut === 200 &&
    dossier.contenu?.donnees?.consultations?.length > 0 &&
    dossier.contenu?.donnees?.factures?.length > 0,
  `statut ${dossier.statut}`
);

// --- 9. Tableau de bord + parametre du tarif --------------------------------
const tableau = await lire('/clinique/tableau-de-bord');
verifier(
  'tableau de bord clinique',
  tableau.statut === 200 && tableau.contenu?.donnees?.nbConsultations > 0,
  `statut ${tableau.statut}`
);

const parametres = await lire('/parametres/publics');
verifier(
  'parametre du tarif de consultation expose',
  parametres.statut === 200 && parametres.contenu?.donnees?.['clinique.consultation.frais'] === 5000,
  `valeur ${parametres.contenu?.donnees?.['clinique.consultation.frais']}`
);

// --- 10. Modification du tarif par la Direction -----------------------------
const majTarif = await appel('/parametres/clinique.consultation.frais', {
  method: 'PUT',
  ...corps({ valeur: 6000 }),
});
verifier('modification du tarif par la direction', majTarif.statut === 200, `statut ${majTarif.statut}`);
// Retablissement du tarif par defaut pour laisser la base dans son etat initial.
await appel('/parametres/clinique.consultation.frais', {
  method: 'PUT',
  ...corps({ valeur: 5000 }),
});

// --- 11. Accueil : correction et annulation d'un passage --------------------
// Praticiens sélectionnables (vétérinaire du passage).
const praticiens = await lire('/clinique/consultations/veterinaires');
verifier(
  'praticiens selectionnables (veterinaire du passage)',
  praticiens.statut === 200 && Array.isArray(praticiens.contenu?.donnees),
  `${praticiens.contenu?.donnees?.length ?? 0} praticien(s)`
);
const veterinaireId = praticiens.contenu?.donnees?.[0]?.id ?? null;

const passageJetable = await poster('/clinique/consultations/accueil', {
  proprietaireId,
  animalId,
  motif: 'Passage cree pour tester la correction',
  veterinaireId,
  paiement: { paye: false },
});
const jetableId = passageJetable.contenu?.donnees?.id;
verifier(
  'passage cree sans paiement (guichet)',
  passageJetable.statut === 201 && passageJetable.contenu?.donnees?.statut === 'EN_ATTENTE_PAIEMENT',
  `statut ${passageJetable.statut}`
);
verifier(
  'veterinaire enregistre sur le passage',
  !veterinaireId || passageJetable.contenu?.donnees?.veterinaireId === veterinaireId,
  `veterinaire ${passageJetable.contenu?.donnees?.veterinaireId ?? '-'}`
);

const correction = await appel(`/clinique/consultations/${jetableId}`, {
  method: 'PATCH',
  ...corps({
    motif: 'Motif corrige depuis l accueil',
    typeConsultation: 'URGENCE',
    notes: 'Correction de saisie',
  }),
});
verifier(
  'correction du passage (motif, type, notes)',
  correction.statut === 200 &&
    correction.contenu?.donnees?.motif === 'Motif corrige depuis l accueil' &&
    correction.contenu?.donnees?.typeConsultation === 'URGENCE',
  `statut ${correction.statut}`
);

const annulationPassage = await poster(`/clinique/consultations/${jetableId}/annuler`, {
  motif: 'Double saisie a l accueil',
});
verifier(
  'annulation du passage',
  annulationPassage.statut === 200 && annulationPassage.contenu?.donnees?.statut === 'ANNULEE',
  `statut ${annulationPassage.statut}`
);

// --- Bilan -------------------------------------------------------------------
const ok = resultats.filter((r) => r.ok).length;
console.log(`\n${ok}/${resultats.length} verifications reussies.`);
if (ordonnanceId) console.log(`Ordonnance de test : ${ordonnanceId}`);

serveur.close();
await fermerPool();
process.exit(ok === resultats.length ? 0 : 1);