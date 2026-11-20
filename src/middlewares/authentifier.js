
// Middleware d'authentification : vérifie le JWT, puis charge le profil
// (compte, rôles, permissions effectives) via session.service.
//
// Le jeton est vérifié à CHAQUE requête (signature + expiration) ; seule la
// lecture en base est mutualisée quelques secondes par un cache invalidé dès
// qu'un changement IAM est publié par le temps réel. Une désactivation de compte
// reste donc appliquée en quelques secondes au plus, et immédiatement pour
// toute action passant par l'API.
//
// Gain : ce middleware passait de 3 requêtes SQL par appel API à un simple
// accès mémoire dans la majorité des cas - c'est ce qui permet de servir
// plusieurs centaines d'utilisateurs simultanés.

import { chargerProfil } from '../modules/auth/session.service.js';
import { ApiError } from '../utils/apiError.js';
import { verifierJetonAcces } from '../utils/jetons.js';

export async function authentifier(req, _res, next) {
  try {
    const entete = req.headers.authorization ?? '';
    if (!entete.startsWith('Bearer ')) {
      throw ApiError.unauthorized("Jeton d'accès manquant.", 'JETON_MANQUANT');
    }

    const jeton = entete.slice(7).trim();
    let charge;
    try {
      charge = verifierJetonAcces(jeton);
    } catch {
      throw ApiError.unauthorized("Jeton d'accès invalide ou expiré.", 'JETON_INVALIDE');
    }

    const profil = await chargerProfil(charge.sub);

    if (!profil) throw ApiError.unauthorized('Compte introuvable.', 'COMPTE_INTROUVABLE');
    if (profil.statut !== 'ACTIF') {
      throw ApiError.forbidden('Compte inactif, suspendu ou archivé.', 'COMPTE_INACTIF');
    }

    req.utilisateur = {
      ...profil,
      // Dépend du jeton présenté : jamais mis en cache
      jetonExpireLe: charge.exp ? new Date(charge.exp * 1000).toISOString() : null,
    };

    next();
  } catch (erreur) {
    next(erreur);
  }
}
