// =============================================================================
// Entrée serverless pour Vercel (@vercel/node).
//
// Vercel attend qu'un fichier de fonction exporte PAR DÉFAUT une fonction ou un
// serveur HTTP. On lui expose donc l'application Express construite par
// `creerApplication()`, sans démarrer d'écoute HTTP (c'est Vercel qui s'en
// charge).
//
// Pourquoi ne pas utiliser index.js : `index.js` est un serveur autonome
// (cluster + `application.listen()` + bus temps réel LISTEN/NOTIFY). En
// serverless, chaque requête peut s'exécuter dans une instance éphémère : il
// ne doit donc y avoir NI écoute, NI état partagé au chargement du module.
//
// Les routes sont montées sous /api dans src/app.js ; la réécriture de
// vercel.json préserve le chemin d'origine (/api/...) vu par Express.
// =============================================================================

import { creerApplication } from '../src/app.js';

const application = creerApplication();

export default application;
