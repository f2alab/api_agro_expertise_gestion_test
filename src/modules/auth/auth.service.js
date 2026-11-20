
// Service d'authentification : connexion, rafraîchissement de session,
// déconnexion, changement / réinitialisation de mot de passe.
//
// Politique de sécurité appliquée :
//  - verrouillage temporaire du compte après N échecs consécutifs
//  - rotation du jeton de rafraîchissement à chaque utilisation
//  - détection de réutilisation d'un jeton révoqué (vol de session)
//  - journalisation systématique dans journal_audit

import { config } from '../../config/env.js';
import { query, transaction } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';
import { hacherMotDePasse, verifierMotDePasse } from '../../utils/password.js';
import {
  dateExpirationRafraichissement,
  empreinteJeton,
  genererJetonOpaque,
  signerJetonAcces,
} from '../../utils/jetons.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import {
  obtenirProfilComplet,
  revoquerToutesSessions,
} from '../users/users.service.js';

const DUREE_JETON_REINITIALISATION_MINUTES = 30;

/** Construit la réponse d'authentification (jetons + profil). */
function reponseAuthentification(profil, jetonRafraichissement) {
  return {
    jetonAcces: signerJetonAcces({ ...profil, super_admin: profil.superAdmin }),
    jetonRafraichissement,
    typeJeton: 'Bearer',
    expireDans: config.jwt.dureeAcces,
    utilisateur: profil,
  };
}

/**
 * Authentifie un utilisateur par e-mail + mot de passe.
 * @throws {ApiError} 401 identifiants invalides, 403 compte inactif, 423 compte verrouillé
 */
export async function connecter({ email, motDePasse, req }) {
  const { rows } = await query(
    `SELECT id, email, nom, prenom, statut, super_admin, mot_de_passe_hash,
            tentatives_connexion, verrouille_jusqua
     FROM utilisateurs
     WHERE lower(email) = lower($1)`,
    [email]
  );
  const compte = rows[0];

  // 1) Compte inexistant : même message que pour un mot de passe erroné
  if (!compte) {
    await enregistrerAudit({
      action: 'CONNEXION',
      statut: 'ECHEC',
      acteurEmail: email,
      req,
      details: { motif: 'compte_inconnu' },
    });
    throw ApiError.unauthorized('E-mail ou mot de passe incorrect.', 'IDENTIFIANTS_INVALIDES');
  }

  // 2) Compte non actif
  if (compte.statut !== 'ACTIF') {
    await enregistrerAudit({
      action: 'CONNEXION',
      statut: 'ECHEC',
      utilisateurId: compte.id,
      acteurEmail: compte.email,
      req,
      details: { motif: 'compte_inactif', statut: compte.statut },
    });
    throw ApiError.forbidden(
      'Ce compte est inactif, suspendu ou archivé. Contactez un administrateur.',
      'COMPTE_INACTIF'
    );
  }

  // 3) Verrouillage temporaire en cours
  if (compte.verrouille_jusqua && new Date(compte.verrouille_jusqua) > new Date()) {
    throw ApiError.locked(
      `Compte temporairement verrouillé. Réessayez après ${new Date(compte.verrouille_jusqua).toLocaleTimeString('fr-FR')}.`,
      'COMPTE_VERROUILLE',
      { verrouilleJusqua: compte.verrouille_jusqua }
    );
  }

  // 4) Vérification du mot de passe
  const motDePasseValide = await verifierMotDePasse(motDePasse, compte.mot_de_passe_hash);

  if (!motDePasseValide) {
    const tentatives = compte.tentatives_connexion + 1;
    const doitVerrouiller = tentatives >= config.securite.maxTentatives;
    const verrouilleJusqua = doitVerrouiller
      ? new Date(Date.now() + config.securite.dureeVerrouMinutes * 60 * 1000)
      : null;

    await query(
      `UPDATE utilisateurs
       SET tentatives_connexion = $2, verrouille_jusqua = $3
       WHERE id = $1`,
      [compte.id, tentatives, verrouilleJusqua]
    );

    await enregistrerAudit({
      action: 'CONNEXION',
      statut: 'ECHEC',
      utilisateurId: compte.id,
      acteurEmail: compte.email,
      req,
      details: { motif: 'mot_de_passe_incorrect', tentatives },
    });

    if (doitVerrouiller) {
      throw ApiError.locked(
        `Trop de tentatives échouées. Compte verrouillé pendant ${config.securite.dureeVerrouMinutes} minutes.`,
        'COMPTE_VERROUILLE',
        { verrouilleJusqua }
      );
    }

    throw ApiError.unauthorized('E-mail ou mot de passe incorrect.', 'IDENTIFIANTS_INVALIDES', {
      tentativesRestantes: Math.max(config.securite.maxTentatives - tentatives, 0),
    });
  }

  // 5) Succès : réinitialisation du compteur, mise à jour de la dernière connexion
  await query(
    `UPDATE utilisateurs
     SET tentatives_connexion = 0, verrouille_jusqua = NULL, derniere_connexion = now()
     WHERE id = $1`,
    [compte.id]
  );

  const jetonRafraichissement = genererJetonOpaque();
  await query(
    `INSERT INTO jetons_rafraichissement
       (utilisateur_id, jeton_hash, user_agent, adresse_ip, expire_le)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      compte.id,
      empreinteJeton(jetonRafraichissement),
      String(req?.headers['user-agent'] ?? '').slice(0, 500) || null,
      String(req?.ip ?? '').slice(0, 60) || null,
      dateExpirationRafraichissement(),
    ]
  );

  await enregistrerAudit({
    action: 'CONNEXION',
    utilisateurId: compte.id,
    acteurEmail: compte.email,
    req,
    details: { resultat: 'succes' },
  });

  const profil = await obtenirProfilComplet(compte.id);
  return reponseAuthentification(profil, jetonRafraichissement);
}

/**
 * Rafraîchit une session expirée : le jeton de rafraîchissement est consommé
 * et remplacé par un nouveau (rotation systématique).
 */
export async function rafraichir({ jetonRafraichissement, req }) {
  const { rows } = await query(
    `SELECT jr.id, jr.utilisateur_id, jr.expire_le, jr.revoque_le,
            u.email, u.statut
     FROM jetons_rafraichissement jr
     JOIN utilisateurs u ON u.id = jr.utilisateur_id
     WHERE jr.jeton_hash = $1`,
    [empreinteJeton(jetonRafraichissement)]
  );
  const session = rows[0];

  if (!session) {
    throw ApiError.unauthorized('Session inconnue. Veuillez vous reconnecter.', 'SESSION_INCONNUE');
  }

  // Un jeton déjà révoqué qui revient = probable vol de session
  if (session.revoque_le) {
    await revoquerToutesSessions(session.utilisateur_id);
    await enregistrerAudit({
      action: 'REUTILISATION_JETON',
      statut: 'ECHEC',
      utilisateurId: session.utilisateur_id,
      acteurEmail: session.email,
      req,
      details: { motif: 'jeton_revoque_reutilise' },
    });
    throw ApiError.unauthorized(
      'Session invalide. Toutes les sessions ont été révoquées par sécurité.',
      'SESSION_REUTILISEE'
    );
  }

  if (new Date(session.expire_le) <= new Date()) {
    throw ApiError.unauthorized('Session expirée. Veuillez vous reconnecter.', 'SESSION_EXPIREE');
  }

  if (session.statut !== 'ACTIF') {
    throw ApiError.forbidden('Compte inactif.', 'COMPTE_INACTIF');
  }

  const nouveauJeton = genererJetonOpaque();
  await transaction(async (client) => {
    await client.query('UPDATE jetons_rafraichissement SET revoque_le = now() WHERE id = $1', [
      session.id,
    ]);
    await client.query(
      `INSERT INTO jetons_rafraichissement
         (utilisateur_id, jeton_hash, user_agent, adresse_ip, expire_le)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        session.utilisateur_id,
        empreinteJeton(nouveauJeton),
        String(req?.headers['user-agent'] ?? '').slice(0, 500) || null,
        String(req?.ip ?? '').slice(0, 60) || null,
        dateExpirationRafraichissement(),
      ]
    );
  });

  const profil = await obtenirProfilComplet(session.utilisateur_id);
  return reponseAuthentification(profil, nouveauJeton);
}

/** Déconnecte une session (révoque le jeton de rafraîchissement fourni). */
export async function deconnecter({ jetonRafraichissement, utilisateur, req }) {
  const { rowCount } = await query(
    `UPDATE jetons_rafraichissement SET revoque_le = now()
     WHERE jeton_hash = $1 AND revoque_le IS NULL`,
    [empreinteJeton(jetonRafraichissement)]
  );

  await enregistrerAudit({
    action: 'DECONNEXION',
    utilisateurId: utilisateur?.id ?? null,
    acteurEmail: utilisateur?.email ?? null,
    req,
    details: { sessionRevoquee: rowCount > 0 },
  });

  return { deconnecte: true };
}

/** Change le mot de passe de l'utilisateur connecté (exige l'ancien mot de passe). */
export async function changerMotDePasse({
  utilisateurId,
  acteurEmail,
  ancienMotDePasse,
  nouveauMotDePasse,
  req,
}) {
  const { rows } = await query('SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1', [
    utilisateurId,
  ]);
  if (!rows[0]) throw ApiError.notFound('Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');

  const ancienValide = await verifierMotDePasse(ancienMotDePasse, rows[0].mot_de_passe_hash);
  if (!ancienValide) {
    await enregistrerAudit({
      action: 'CHANGEMENT_MOT_DE_PASSE',
      statut: 'ECHEC',
      utilisateurId,
      acteurEmail,
      req,
      details: { motif: 'ancien_mot_de_passe_incorrect' },
    });
    throw ApiError.badRequest('Ancien mot de passe incorrect.', 'MOT_DE_PASSE_INCORRECT');
  }

  if (ancienMotDePasse === nouveauMotDePasse) {
    throw ApiError.badRequest(
      'Le nouveau mot de passe doit être différent de l’ancien.',
      'MOT_DE_PASSE_IDENTIQUE'
    );
  }

  const empreinte = await hacherMotDePasse(nouveauMotDePasse);
  await query(
    `UPDATE utilisateurs
     SET mot_de_passe_hash = $2, doit_changer_mdp = FALSE,
         tentatives_connexion = 0, verrouille_jusqua = NULL
     WHERE id = $1`,
    [utilisateurId, empreinte]
  );

  // Par sécurité, toutes les sessions existantes sont coupées
  const { sessionsRevoguees } = await revoquerToutesSessions(utilisateurId);

  await enregistrerAudit({
    action: 'CHANGEMENT_MOT_DE_PASSE',
    utilisateurId,
    acteurEmail,
    req,
    details: { sessionsRevoguees },
  });

  return { modifie: true, sessionsRevoguees };
}

/**
 * Demande de réinitialisation « mot de passe oublié ».
 * Anti-énumération : la réponse est identique que le compte existe ou non.
 * En développement, le jeton est renvoyé dans la réponse (aucun e-mail envoyé).
 */
export async function demanderReinitialisation({ email, req }) {
  const reponse = {
    message:
      'Si un compte actif correspond à cette adresse, un jeton de réinitialisation a été généré.',
    jetonReinitialisation: null,
  };

  const { rows } = await query(
    "SELECT id, email FROM utilisateurs WHERE lower(email) = lower($1) AND statut = 'ACTIF'",
    [email]
  );
  const compte = rows[0];
  if (!compte) return reponse;

  const jeton = genererJetonOpaque();
  await transaction(async (client) => {
    await client.query(
      `UPDATE jetons_reinitialisation SET utilise_le = now()
       WHERE utilisateur_id = $1 AND utilise_le IS NULL`,
      [compte.id]
    );
    await client.query(
      `INSERT INTO jetons_reinitialisation (utilisateur_id, jeton_hash, expire_le)
       VALUES ($1, $2, $3)`,
      [
        compte.id,
        empreinteJeton(jeton),
        new Date(Date.now() + DUREE_JETON_REINITIALISATION_MINUTES * 60 * 1000),
      ]
    );
  });

  await enregistrerAudit({
    action: 'DEMANDE_REINITIALISATION_MDP',
    utilisateurId: compte.id,
    acteurEmail: compte.email,
    req,
    details: { expireDansMinutes: DUREE_JETON_REINITIALISATION_MINUTES },
  });

  // Développement : le jeton est exposé pour permettre les tests sans serveur mail
  if (!config.estProduction) reponse.jetonReinitialisation = jeton;

  return reponse;
}

/** Finalise la réinitialisation à partir d'un jeton à usage unique. */
export async function reinitialiserAvecJeton({ jeton, nouveauMotDePasse, req }) {
  const { rows } = await query(
    `SELECT jr.id, jr.utilisateur_id, jr.expire_le, jr.utilise_le, u.email
     FROM jetons_reinitialisation jr
     JOIN utilisateurs u ON u.id = jr.utilisateur_id
     WHERE jr.jeton_hash = $1`,
    [empreinteJeton(jeton)]
  );
  const demande = rows[0];

  if (!demande || demande.utilise_le || new Date(demande.expire_le) <= new Date()) {
    throw ApiError.badRequest(
      'Jeton de réinitialisation invalide, expiré ou déjà utilisé.',
      'JETON_REINITIALISATION_INVALIDE'
    );
  }

  const empreinte = await hacherMotDePasse(nouveauMotDePasse);

  await transaction(async (client) => {
    await client.query(
      `UPDATE utilisateurs
       SET mot_de_passe_hash = $2, doit_changer_mdp = FALSE,
           tentatives_connexion = 0, verrouille_jusqua = NULL
       WHERE id = $1`,
      [demande.utilisateur_id, empreinte]
    );
    await client.query('UPDATE jetons_reinitialisation SET utilise_le = now() WHERE id = $1', [
      demande.id,
    ]);
    await client.query(
      `UPDATE jetons_rafraichissement SET revoque_le = now()
       WHERE utilisateur_id = $1 AND revoque_le IS NULL`,
      [demande.utilisateur_id]
    );
  });

  await enregistrerAudit({
    action: 'REINITIALISATION_MDP',
    utilisateurId: demande.utilisateur_id,
    acteurEmail: demande.email,
    req,
  });

  return { reinitialise: true, email: demande.email };
}