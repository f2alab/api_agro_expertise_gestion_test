
// Erreur métier normalisée : porte le code HTTP et un code fonctionnel lisible
// par le frontend (ex. IDENTIFIANTS_INVALIDES, PERMISSION_REFUSEE).

export class ApiError extends Error {
  /**
   * @param {number} statut   Code HTTP
   * @param {string} message  Message destiné à l'utilisateur
   * @param {string} code     Code fonctionnel (majuscules)
   * @param {any}    details  Informations complémentaires (champs invalides...)
   */
  constructor(statut, message, code = 'ERREUR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.statut = statut;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Requête invalide.', code = 'REQUETE_INVALIDE', details = null) {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message = 'Authentification requise.', code = 'NON_AUTHENTIFIE', details = null) {
    return new ApiError(401, message, code, details);
  }

  static forbidden(message = 'Accès refusé.', code = 'ACCES_REFUSE', details = null) {
    return new ApiError(403, message, code, details);
  }

  static notFound(message = 'Ressource introuvable.', code = 'INTROUVABLE', details = null) {
    return new ApiError(404, message, code, details);
  }

  static conflict(message = 'Conflit avec les données existantes.', code = 'CONFLIT', details = null) {
    return new ApiError(409, message, code, details);
  }

  static locked(message = 'Compte temporairement verrouillé.', code = 'COMPTE_VERROUILLE', details = null) {
    return new ApiError(423, message, code, details);
  }

  static tooManyRequests(message = 'Trop de requêtes.', code = 'TROP_DE_REQUETES', details = null) {
    return new ApiError(429, message, code, details);
  }

  static internal(message = 'Erreur interne du serveur.', code = 'ERREUR_INTERNE', details = null) {
    return new ApiError(500, message, code, details);
  }
}