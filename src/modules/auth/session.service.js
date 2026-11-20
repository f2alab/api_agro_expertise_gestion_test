
// Profil authentifié : rechargement du compte, de ses rôles et de ses
// permissions effectives, avec un cache mémoire à très courte durée de vie.
//
// Pourquoi un cache : chaque appel d'API rechargeait le profil (3 requêtes
// SQL), ce qui multipliait la charge sur PostgreSQL dès quelques centaines
// d'utilisateurs actifs.
//
// Pourquoi la sécurité n'est pas dégradée :
//   * TTL court (CACHE_AUTH_SECONDES, 5 s par défaut) ;
//   * invalidation IMMÉDIATE dès qu'un événement IAM est reçu (compte, rôle,
//     permission, département) : une désactivation ou un retrait de rôle est
//     appliqué aussitôt, sans attendre l'expiration ;
//   * les profils introuvables ne sont jamais mis en cache ;
//   * le jeton reste vérifié à chaque requête (signature + expiration).

import { query } from '../../config/database.js';
import { config } from '../../config/env.js';
import { abonner } from '../../realtime/bus.js';
import { creerCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { urlPhoto } from '../users/users.service.js';

const REQUETE_UTILISATEUR = `
  SELECT u.id, u.matricule, u.nom, u.prenom, u.email, u.telephone, u.fonction,
         u.statut, u.super_admin, u.doit_changer_mdp, u.departement_id,
         d.code AS departement_code, d.nom AS departement_nom,
         u.point_vente_id,
         pv.code AS point_vente_code, pv.nom AS point_vente_nom,
         pv.type_point AS point_vente_type,
         (
           SELECT photo.updated_at FROM utilisateurs_photos photo
           WHERE photo.utilisateur_id = u.id
         ) AS photo_maj_le,
         (
           u.super_admin OR EXISTS (
             SELECT 1 FROM utilisateurs_roles ur
             JOIN roles r ON r.id = ur.role_id
             WHERE ur.utilisateur_id = u.id AND r.actif = TRUE
               AND r.code IN ('DG','DGA','COMPTABLE','DIR_TECHNIQUE','TRESORIER','AUDITEUR')
           )
         ) AS portee_globale
  FROM utilisateurs u
  LEFT JOIN departements d ON d.id = u.departement_id
  LEFT JOIN pharmacie_points pv ON pv.id = u.point_vente_id
  WHERE u.id = $1
`;

const cacheProfils = creerCache({
  nom: 'profils-authentifies',
  ttlSecondes: config.securite.cacheAuthSecondes,
  maximum: 50_000,
});

// Invalidation immédiate sur tout changement touchant les comptes ou les droits
const desabonnerBus = abonner((evenement) => {
  if (evenement.type.startsWith('iam.')) cacheProfils.invaliderTout();
});

/** Lit le profil complet (avec rôles et permissions) pour un identifiant. */
async function lireProfil(utilisateurId) {
  const [utilisateur, permissions, roles] = await Promise.all([
    query(REQUETE_UTILISATEUR, [utilisateurId]),
    query('SELECT code_permission FROM fn_permissions_utilisateur($1)', [utilisateurId]),
    query(
      `SELECT r.id, r.code, r.nom
       FROM utilisateurs_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.utilisateur_id = $1 AND r.actif = TRUE
       ORDER BY r.niveau, r.code`,
      [utilisateurId]
    ),
  ]);

  const ligne = utilisateur.rows[0];
  if (!ligne) return null;

  return {
    id: ligne.id,
    matricule: ligne.matricule,
    nom: ligne.nom,
    prenom: ligne.prenom,
    email: ligne.email,
    telephone: ligne.telephone,
    fonction: ligne.fonction,
    statut: ligne.statut,
    superAdmin: ligne.super_admin,
    doitChangerMdp: ligne.doit_changer_mdp,
    departementId: ligne.departement_id,
    departementCode: ligne.departement_code,
    departementNom: ligne.departement_nom,
    pointVenteId: ligne.point_vente_id ?? null,
    pointVenteCode: ligne.point_vente_code ?? null,
    pointVenteNom: ligne.point_vente_nom ?? null,
    // Type de pharmacie de rattachement (SIEGE | SUCCURSALE | MAGASIN) : permet
    // au frontend d'adapter l'affichage (ex. fournisseur principal des
    // succursales masque pour la direction, le siege ou le magasin).
    pointVenteType: ligne.point_vente_type ?? null,
    // Photo de profil : seule son URL est exposée (l'image est servie par
    // GET /api/utilisateurs/:id/photo). Le cache est vidé dès qu'un événement
    // `iam.*` est reçu, donc l'en-tête de l'application suit sans délai.
    photoUrl: urlPhoto(ligne.id, ligne.photo_maj_le),
    porteeGlobale: Boolean(ligne.portee_globale),
    roles: roles.rows.map((role) => ({ id: role.id, code: role.code, nom: role.nom })),
    permissions: permissions.rows.map((lignePermission) => lignePermission.code_permission),
  };
}

/**
 * Charge le profil authentifié (cache puis base de données).
 * Renvoie null si le compte n'existe plus.
 */
export async function chargerProfil(utilisateurId) {
  if (!utilisateurId) return null;

  const enCache = cacheProfils.lire(utilisateurId);
  if (enCache !== undefined) return enCache;

  try {
    const profil = await lireProfil(utilisateurId);
    // Les profils introuvables ne sont pas mémorisés : un compte recréé ou
    // réactivé dans la seconde doit être vu immédiatement.
    if (profil) cacheProfils.ecrire(utilisateurId, profil);
    return profil;
  } catch (erreur) {
    // En cas de panne de base, on ne sert pas de données potentiellement fausses
    logger.warn('Lecture du profil impossible', erreur.message);
    return null;
  }
}

/** Vide le cache des profils (déconnexion de masse, maintenance). */
export const invaliderProfils = () => cacheProfils.invaliderTout();

/** Statistiques du cache (supervision). */
export const statistiquesProfils = () => cacheProfils.stats();

/** Retire l'abonnement au bus (arrêt du serveur). */
export const arreterCacheProfils = () => desabonnerBus();
