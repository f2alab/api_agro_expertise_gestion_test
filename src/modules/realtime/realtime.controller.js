
// Contrôleur du module Temps réel.
//  - /flux  : flux SSE (une requête gardée ouverte par onglet)
//  - /etat  : supervision du bus PostgreSQL, des flux et des caches mémoire
//  - /types : catalogue des types d'événements et de la permission associée

import { etatBus } from '../../realtime/bus.js';
import { TYPES_EVENEMENTS } from '../../realtime/evenements.js';
import { etatFlux, ouvrirFlux } from '../../realtime/sse.js';
import { statistiquesProfils } from '../auth/session.service.js';
import { statistiquesReponses } from '../../middlewares/cacheReponse.js';
import { statistiquesLimiteurs } from '../../middlewares/limiteRequetes.js';
import { statistiquesHachage } from '../../utils/hachage.js';
import { succes } from '../../utils/reponses.js';

/**
 * GET /api/temps-reel/flux
 * Ouvre le flux de notifications. La réponse ne se termine jamais d'elle-même :
 * elle est fermée par le client, par la durée maximale ou à l'arrêt du serveur.
 */
export function flux(req, res) {
  ouvrirFlux(req, res, req.utilisateur);
}

/** GET /api/temps-reel/etat : état du bus, des flux et des caches (aucune donnée métier). */
export function etat(_req, res) {
  return succes(res, {
    bus: etatBus(),
    flux: etatFlux(),
    caches: {
      profils: statistiquesProfils(),
      reponses: statistiquesReponses(),
    },
    hachage: statistiquesHachage(),
    limites: statistiquesLimiteurs(),
  });
}

/** GET /api/temps-reel/types : catalogue { type: permission requise }. */
export function types(_req, res) {
  return succes(res, TYPES_EVENEMENTS);
}
