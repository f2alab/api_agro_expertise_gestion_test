
// Service Utilisateurs : lecture, création, modification, archivage,
// affectation des rôles, réinitialisation de mot de passe et sessions.
// Toutes les requêtes SQL du module sont regroupées ici (couche d'accès données).

import { query, transaction } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';
import { creerEmpreinte, decoderPhotoBase64 } from '../../utils/images.js';
import { genererMotDePasseProvisoire, hacherMotDePasse } from '../../utils/password.js';
import { lirePagination, reponsePaginee } from '../../utils/pagination.js';

// Colonnes exposées par l'API (le hash du mot de passe n'en fait jamais partie)
const COLONNES_UTILISATEUR = `
  u.id, u.matricule, u.nom, u.prenom, u.email, u.telephone, u.fonction,
  u.statut, u.super_admin, u.doit_changer_mdp, u.derniere_connexion,
  u.verrouille_jusqua, u.created_at, u.updated_at, u.departement_id,
  d.code AS departement_code, d.nom AS departement_nom, d.type_unite AS departement_type,
  u.point_vente_id, pv.code AS point_vente_code, pv.nom AS point_vente_nom,
  pv.type_point AS point_vente_type,
  (
    SELECT photo.updated_at FROM utilisateurs_photos photo
    WHERE photo.utilisateur_id = u.id
  ) AS photo_maj_le
`;

// Rôles agrégés en JSON pour éviter le produit cartésien en cas de jointure
const ROLES_AGREGES = `
  COALESCE((
    SELECT json_agg(
             json_build_object('id', ro.id, 'code', ro.code, 'nom', ro.nom, 'niveau', ro.niveau)
             ORDER BY ro.niveau, ro.code
           )
    FROM utilisateurs_roles ur
    JOIN roles ro ON ro.id = ur.role_id
    WHERE ur.utilisateur_id = u.id
  ), '[]'::json) AS roles
`;

/** Transforme une ligne SQL en objet JSON camelCase destiné à l'API. */
export function serialiserUtilisateur(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    matricule: ligne.matricule,
    nom: ligne.nom,
    prenom: ligne.prenom,
    nomComplet: `${ligne.nom} ${ligne.prenom}`.trim(),
    email: ligne.email,
    telephone: ligne.telephone ?? null,
    fonction: ligne.fonction ?? null,
    statut: ligne.statut,
    superAdmin: Boolean(ligne.super_admin),
    doitChangerMdp: Boolean(ligne.doit_changer_mdp),
    derniereConnexion: ligne.derniere_connexion ?? null,
    verrouilleJusqua: ligne.verrouille_jusqua ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
    departement: ligne.departement_id
      ? {
          id: ligne.departement_id,
          code: ligne.departement_code,
          nom: ligne.departement_nom,
          typeUnite: ligne.departement_type ?? null,
        }
      : null,
    pointVente: ligne.point_vente_id
      ? {
          id: ligne.point_vente_id,
          code: ligne.point_vente_code,
          nom: ligne.point_vente_nom,
          typePoint: ligne.point_vente_type ?? null,
        }
      : null,
    roles: ligne.roles ?? [],
    // La photo n'est jamais incluse dans le JSON (volume) : seule son URL est
    // exposée, l'image étant servie par GET /api/utilisateurs/:id/photo.
    photoUrl: urlPhoto(ligne.id, ligne.photo_maj_le),
  };
}

/**
 * URL (relative à /api) de la photo de profil, versionnée pour le cache.
 * Renvoie null quand le compte n'a pas de photo : le frontend affiche alors
 * les initiales du nom.
 *
 * @param {string} utilisateurId
 * @param {Date|string|null} miseAJour colonne `utilisateurs_photos.updated_at`
 */
export function urlPhoto(utilisateurId, miseAJour) {
  if (!miseAJour) return null;
  return `/utilisateurs/${utilisateurId}/photo?v=${new Date(miseAJour).getTime()}`;
}

// -----------------------------------------------------------------------------
// Lecture
// -----------------------------------------------------------------------------

/**
 * Liste paginée des utilisateurs.
 * @param {object} filtres page, limite, recherche, departementId (inclut les
 *                         sous-départements), statut, roleId, actif
 */
export async function listerUtilisateurs(filtres = {}) {
  const { page, limite, offset } = lirePagination(filtres);
  const conditions = [];
  const parametres = [];

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(u.nom ILIKE $${i} OR u.prenom ILIKE $${i} OR u.email ILIKE $${i} OR u.matricule ILIKE $${i})`
    );
  }
  if (filtres.departementId) {
    parametres.push(filtres.departementId);
    // Filtre sur le sous-arbre du département (chemin matérialisé)
    conditions.push(`(
      u.departement_id = $${parametres.length}
      OR EXISTS (
        SELECT 1 FROM departements enfant
        WHERE enfant.id = u.departement_id
          AND enfant.chemin LIKE (
            (SELECT chemin FROM departements WHERE id = $${parametres.length}) || '%'
          )
      )
    )`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`u.statut = $${parametres.length}`);
  }
  if (filtres.roleId) {
    parametres.push(filtres.roleId);
    conditions.push(
      `EXISTS (SELECT 1 FROM utilisateurs_roles ur WHERE ur.utilisateur_id = u.id AND ur.role_id = $${parametres.length})`
    );
  }

  const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [compteur, liste] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM utilisateurs u ${clauseWhere}`, parametres),
    query(
      `SELECT ${COLONNES_UTILISATEUR}, ${ROLES_AGREGES}
       FROM utilisateurs u
       LEFT JOIN departements d ON d.id = u.departement_id
       LEFT JOIN pharmacie_points pv ON pv.id = u.point_vente_id
       ${clauseWhere}
       ORDER BY u.nom ASC, u.prenom ASC
       LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, offset]
    ),
  ]);

  return reponsePaginee(liste.rows.map(serialiserUtilisateur), compteur.rows[0].total, {
    page,
    limite,
  });
}

/** Récupère un utilisateur complet (avec ses rôles) ou null. */
export async function obtenirUtilisateur(id) {
  const { rows } = await query(
    `SELECT ${COLONNES_UTILISATEUR}, ${ROLES_AGREGES}
     FROM utilisateurs u
     LEFT JOIN departements d ON d.id = u.departement_id
     LEFT JOIN pharmacie_points pv ON pv.id = u.point_vente_id
     WHERE u.id = $1`,
    [id]
  );
  return serialiserUtilisateur(rows[0]);
}

/** Récupère un utilisateur ou lève une 404. */
export async function exigerUtilisateur(id) {
  const utilisateur = await obtenirUtilisateur(id);
  if (!utilisateur) throw ApiError.notFound('Utilisateur introuvable.', 'UTILISATEUR_INTROUVABLE');
  return utilisateur;
}

// -----------------------------------------------------------------------------
// Écriture
// -----------------------------------------------------------------------------

/** Génère le prochain matricule au format GAE-0001. */
async function genererMatricule() {
  const { rows } = await query(`
    SELECT 'GAE-' || lpad(
             (COALESCE(MAX(NULLIF(regexp_replace(matricule, '\\D', '', 'g'), '')::int), 0) + 1)::text,
             4, '0'
           ) AS matricule
    FROM utilisateurs
  `);
  return rows[0].matricule;
}

/** Vérifie qu'un e-mail n'est pas déjà utilisé par un autre compte. */
async function verifierEmailDisponible(email, utilisateurId = null) {
  const { rowCount } = await query(
    'SELECT 1 FROM utilisateurs WHERE lower(email) = lower($1) AND ($2::uuid IS NULL OR id <> $2)',
    [email, utilisateurId]
  );
  if (rowCount > 0) {
    throw ApiError.conflict('Un compte utilise déjà cet e-mail.', 'EMAIL_DEJA_UTILISE', {
      champ: 'email',
    });
  }
}

/** Remplace les rôles d'un utilisateur (dans une transaction existante). */
async function remplacerRolesDansTransaction(client, utilisateurId, roleIds, attribuePar) {
  if (!Array.isArray(roleIds)) return;

  if (roleIds.length > 0) {
    const { rows } = await client.query(
      'SELECT id FROM roles WHERE id = ANY($1::uuid[]) AND actif = TRUE',
      [roleIds]
    );
    if (rows.length !== new Set(roleIds).size) {
      throw ApiError.badRequest(
        'Un ou plusieurs rôles sont introuvables ou inactifs.',
        'ROLE_INVALIDE'
      );
    }
  }

  await client.query('DELETE FROM utilisateurs_roles WHERE utilisateur_id = $1', [utilisateurId]);
  if (roleIds.length === 0) return;

  await client.query(
    `INSERT INTO utilisateurs_roles (utilisateur_id, role_id, attribue_par)
     SELECT $1::uuid, unnest($2::uuid[]), $3::uuid
     ON CONFLICT DO NOTHING`,
    [utilisateurId, roleIds, attribuePar ?? null]
  );
}

/** Synchronise le département principal dans la table des affectations. */
async function synchroniserDepartementPrincipal(client, utilisateurId, departementId) {
  await client.query(
    'UPDATE utilisateurs_departements SET principal = FALSE WHERE utilisateur_id = $1',
    [utilisateurId]
  );
  await client.query(
    `INSERT INTO utilisateurs_departements (utilisateur_id, departement_id, principal)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (utilisateur_id, departement_id) DO UPDATE SET principal = TRUE`,
    [utilisateurId, departementId]
  );
}

/**
 * Crée un compte utilisateur.
 * Si aucun mot de passe n'est fourni, un mot de passe provisoire est généré
 * et renvoyé une seule fois à l'administrateur.
 */
export async function creerUtilisateur(donnees, acteur) {
  const email = donnees.email.trim().toLowerCase();
  await verifierEmailDisponible(email);

  const motDePasseImpose = Boolean(donnees.motDePasse);
  const motDePasse = donnees.motDePasse ?? genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(motDePasse);
  const matricule = donnees.matricule?.trim() || (await genererMatricule());

  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO utilisateurs
         (matricule, nom, prenom, email, telephone, mot_de_passe_hash, departement_id,
          point_vente_id, fonction, statut, super_admin, doit_changer_mdp, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        matricule,
        donnees.nom.trim(),
        donnees.prenom.trim(),
        email,
        donnees.telephone ?? null,
        empreinte,
        donnees.departementId ?? null,
        donnees.pointVenteId ?? null,
        donnees.fonction ?? null,
        donnees.statut ?? 'ACTIF',
        Boolean(donnees.superAdmin),
        true, // changement de mot de passe conseillé à la première connexion
        acteur?.id ?? null,
      ]
    );

    const nouvelId = rows[0].id;
    await remplacerRolesDansTransaction(client, nouvelId, donnees.roleIds ?? [], acteur?.id);
    if (donnees.departementId) {
      await synchroniserDepartementPrincipal(client, nouvelId, donnees.departementId);
    }
    return nouvelId;
  });

  return {
    utilisateur: await obtenirUtilisateur(id),
    motDePasseProvisoire: motDePasseImpose ? null : motDePasse,
  };
}

/** Empêche de retirer le dernier super administrateur actif de la plateforme. */
async function verifierDernierSuperAdmin(utilisateurId) {
  const { rows } = await query(
    `SELECT count(*)::int AS total
     FROM utilisateurs
     WHERE super_admin = TRUE AND statut = 'ACTIF' AND id <> $1`,
    [utilisateurId]
  );
  if (rows[0].total === 0) {
    throw ApiError.conflict(
      'Impossible : il doit rester au moins un super administrateur actif.',
      'DERNIER_SUPER_ADMIN'
    );
  }
}

/**
 * Met à jour partiellement un utilisateur (PATCH).
 * Seuls les champs fournis sont modifiés.
 */
export async function modifierUtilisateur(id, donnees, acteur) {
  const existant = await exigerUtilisateur(id);

  if (acteur?.id === id) {
    if (donnees.statut && donnees.statut !== 'ACTIF') {
      throw ApiError.conflict('Vous ne pouvez pas désactiver votre propre compte.', 'ACTION_INTERDITE');
    }
    if (donnees.roleIds !== undefined) {
      throw ApiError.conflict('Vous ne pouvez pas modifier vos propres rôles.', 'ACTION_INTERDITE');
    }
    if (donnees.superAdmin === false) {
      throw ApiError.conflict(
        'Vous ne pouvez pas retirer votre propre statut de super administrateur.',
        'ACTION_INTERDITE'
      );
    }
  }

  if (donnees.email) await verifierEmailDisponible(donnees.email.trim().toLowerCase(), id);
  if (existant.superAdmin && donnees.superAdmin === false) {
    await verifierDernierSuperAdmin(id);
  }

  const champs = [];
  const valeurs = [];
  const ajouterChamp = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  if (donnees.nom !== undefined) ajouterChamp('nom', donnees.nom.trim());
  if (donnees.prenom !== undefined) ajouterChamp('prenom', donnees.prenom.trim());
  if (donnees.email !== undefined) ajouterChamp('email', donnees.email.trim().toLowerCase());
  if (donnees.telephone !== undefined) ajouterChamp('telephone', donnees.telephone || null);
  if (donnees.fonction !== undefined) ajouterChamp('fonction', donnees.fonction || null);
  if (donnees.departementId !== undefined) ajouterChamp('departement_id', donnees.departementId);
  if (donnees.pointVenteId !== undefined) ajouterChamp('point_vente_id', donnees.pointVenteId);
  if (donnees.statut !== undefined) ajouterChamp('statut', donnees.statut);
  if (donnees.superAdmin !== undefined) ajouterChamp('super_admin', donnees.superAdmin);

  if (donnees.motDePasse) {
    ajouterChamp('mot_de_passe_hash', await hacherMotDePasse(donnees.motDePasse));
    ajouterChamp('doit_changer_mdp', true);
    ajouterChamp('tentatives_connexion', 0);
    ajouterChamp('verrouille_jusqua', null);
  }

  await transaction(async (client) => {
    if (champs.length > 0) {
      valeurs.push(id);
      await client.query(
        `UPDATE utilisateurs SET ${champs.join(', ')} WHERE id = $${valeurs.length}`,
        valeurs
      );
    }

    if (donnees.roleIds !== undefined) {
      await remplacerRolesDansTransaction(client, id, donnees.roleIds, acteur?.id);
    }

    if (donnees.departementId !== undefined) {
      if (donnees.departementId) {
        await synchroniserDepartementPrincipal(client, id, donnees.departementId);
      } else {
        await client.query(
          'UPDATE utilisateurs_departements SET principal = FALSE WHERE utilisateur_id = $1',
          [id]
        );
      }
    }

    // Toute désactivation coupe immédiatement les sessions en cours
    if (donnees.statut && donnees.statut !== 'ACTIF') {
      await client.query(
        `UPDATE jetons_rafraichissement SET revoque_le = now()
         WHERE utilisateur_id = $1 AND revoque_le IS NULL`,
        [id]
      );
    }
  });

  return obtenirUtilisateur(id);
}

/** Archive un compte (suppression logique) et révoque ses sessions. */
export async function archiverUtilisateur(id, acteur) {
  if (acteur?.id === id) {
    throw ApiError.conflict('Vous ne pouvez pas archiver votre propre compte.', 'ACTION_INTERDITE');
  }

  const existant = await exigerUtilisateur(id);
  if (existant.superAdmin) await verifierDernierSuperAdmin(id);

  const sessionsRevoquees = await transaction(async (client) => {
    await client.query("UPDATE utilisateurs SET statut = 'ARCHIVE' WHERE id = $1", [id]);
    const { rowCount } = await client.query(
      `UPDATE jetons_rafraichissement SET revoque_le = now()
       WHERE utilisateur_id = $1 AND revoque_le IS NULL`,
      [id]
    );
    return rowCount;
  });

  // Le détail est repris dans le journal d'audit : on y conserve l'identité du
  // compte et son statut précédent, sinon l'événement ne contient qu'un UUID.
  return {
    id,
    statut: 'ARCHIVE',
    email: existant.email,
    matricule: existant.matricule,
    nomComplet: existant.nomComplet,
    statutPrecedent: existant.statut,
    sessionsRevoquees,
  };
}

/** Remplace l'ensemble des rôles d'un utilisateur. */
export async function remplacerRoles(utilisateurId, roleIds, acteur) {
  if (acteur?.id === utilisateurId) {
    throw ApiError.conflict('Vous ne pouvez pas modifier vos propres rôles.', 'ACTION_INTERDITE');
  }
  await exigerUtilisateur(utilisateurId);

  await transaction((client) =>
    remplacerRolesDansTransaction(client, utilisateurId, roleIds, acteur?.id)
  );

  return obtenirUtilisateur(utilisateurId);
}

/** Réinitialise le mot de passe d'un compte et renvoie le mot de passe provisoire. */
export async function reinitialiserMotDePasse(utilisateurId, acteur) {
  // Sécurité : la réinitialisation d'un compte passe par « Mon profil » pour soi-même,
  // afin d'éviter de se verrouiller en générant un mot de passe que l'on ne voit plus.
  if (acteur?.id && acteur.id === utilisateurId) {
    throw ApiError.conflict(
      'Utilisez « Mon profil » pour changer votre propre mot de passe.',
      'ACTION_INTERDITE'
    );
  }

  const existant = await exigerUtilisateur(utilisateurId);

  const motDePasseProvisoire = genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(motDePasseProvisoire);

  const sessionsRevoquees = await transaction(async (client) => {
    await client.query(
      `UPDATE utilisateurs
       SET mot_de_passe_hash = $2, doit_changer_mdp = TRUE,
           tentatives_connexion = 0, verrouille_jusqua = NULL
       WHERE id = $1`,
      [utilisateurId, empreinte]
    );
    const { rowCount } = await client.query(
      `UPDATE jetons_rafraichissement SET revoque_le = now()
       WHERE utilisateur_id = $1 AND revoque_le IS NULL`,
      [utilisateurId]
    );
    return rowCount;
  });

  // L'e-mail de la cible est repris dans le journal d'audit (traçabilité).
  return {
    utilisateurId,
    email: existant.email,
    motDePasseProvisoire,
    sessionsRevoquees,
    effectuePar: acteur?.email ?? null,
  };
}

// -----------------------------------------------------------------------------
// Photo de profil (octets stockés en base, table utilisateurs_photos)
// -----------------------------------------------------------------------------

/** Lit la photo d'un utilisateur (octets + métadonnées) ou lève une 404. */
export async function obtenirPhoto(utilisateurId) {
  const { rows } = await query(
    `SELECT contenu, type_mime, taille_octets, largeur, hauteur, empreinte, updated_at
     FROM utilisateurs_photos
     WHERE utilisateur_id = $1`,
    [utilisateurId]
  );

  const ligne = rows[0];
  if (!ligne) {
    throw ApiError.notFound("Ce compte n'a pas de photo de profil.", 'PHOTO_INTROUVABLE');
  }

  return {
    contenu: ligne.contenu,
    typeMime: ligne.type_mime,
    tailleOctets: ligne.taille_octets,
    largeur: ligne.largeur ?? null,
    hauteur: ligne.hauteur ?? null,
    empreinte: ligne.empreinte,
    majLe: ligne.updated_at,
  };
}

/**
 * Enregistre (ou remplace) la photo de profil d'un utilisateur.
 * Le contenu arrive en base64 : il est décodé ici, son type réel et ses
 * dimensions sont vérifiés (jamais ceux annoncés par le client).
 *
 * @param {string} utilisateurId
 * @param {{contenuBase64: string}} donnees
 */
export async function enregistrerPhoto(utilisateurId, donnees) {
  await exigerUtilisateur(utilisateurId);

  const photo = decoderPhotoBase64(donnees.contenuBase64);

  await query(
    `INSERT INTO utilisateurs_photos
       (utilisateur_id, contenu, type_mime, taille_octets, largeur, hauteur, empreinte)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (utilisateur_id) DO UPDATE SET
       contenu       = EXCLUDED.contenu,
       type_mime     = EXCLUDED.type_mime,
       taille_octets = EXCLUDED.taille_octets,
       largeur       = EXCLUDED.largeur,
       hauteur       = EXCLUDED.hauteur,
       empreinte     = EXCLUDED.empreinte,
       updated_at    = now()`,
    [
      utilisateurId,
      photo.contenu,
      photo.typeMime,
      photo.tailleOctets,
      photo.largeur,
      photo.hauteur,
      creerEmpreinte(photo.contenu),
    ]
  );

  return {
    utilisateur: await obtenirUtilisateur(utilisateurId),
    typeMime: photo.typeMime,
    tailleOctets: photo.tailleOctets,
    largeur: photo.largeur,
    hauteur: photo.hauteur,
  };
}

/** Supprime la photo de profil d'un utilisateur. */
export async function supprimerPhoto(utilisateurId) {
  await exigerUtilisateur(utilisateurId);

  const { rowCount } = await query('DELETE FROM utilisateurs_photos WHERE utilisateur_id = $1', [
    utilisateurId,
  ]);
  if (rowCount === 0) {
    throw ApiError.notFound("Ce compte n'a pas de photo de profil.", 'PHOTO_INTROUVABLE');
  }

  return { utilisateurId, photoUrl: null };
}

// -----------------------------------------------------------------------------
// Sessions (jetons de rafraîchissement)
// -----------------------------------------------------------------------------

/** Liste les sessions d'un utilisateur (les plus récentes d'abord). */
export async function listerSessions(utilisateurId) {
  const { rows } = await query(
    `SELECT id, user_agent, adresse_ip, cree_le, expire_le, revoque_le,
            (revoque_le IS NULL AND expire_le > now()) AS active
     FROM jetons_rafraichissement
     WHERE utilisateur_id = $1
     ORDER BY cree_le DESC
     LIMIT 50`,
    [utilisateurId]
  );

  return rows.map((ligne) => ({
    id: ligne.id,
    userAgent: ligne.user_agent,
    adresseIp: ligne.adresse_ip,
    creeLe: ligne.cree_le,
    expireLe: ligne.expire_le,
    revoqueLe: ligne.revoque_le,
    active: ligne.active,
  }));
}

/** Révoque une session précise d'un utilisateur. */
export async function revoquerSession(utilisateurId, sessionId) {
  const { rowCount } = await query(
    `UPDATE jetons_rafraichissement SET revoque_le = now()
     WHERE id = $1 AND utilisateur_id = $2 AND revoque_le IS NULL`,
    [sessionId, utilisateurId]
  );
  if (rowCount === 0) {
    throw ApiError.notFound('Session introuvable ou déjà révoquée.', 'SESSION_INTROUVABLE');
  }
  return { id: sessionId, revoquee: true };
}

/** Révoque toutes les sessions d'un utilisateur (option : en conserver une). */
export async function revoquerToutesSessions(utilisateurId, exceptionId = null) {
  const { rowCount } = await query(
    `UPDATE jetons_rafraichissement SET revoque_le = now()
     WHERE utilisateur_id = $1 AND revoque_le IS NULL
       AND ($2::uuid IS NULL OR id <> $2)`,
    [utilisateurId, exceptionId]
  );
  return { sessionsRevoguees: rowCount };
}

/** Profil complet utilisé par /auth/me : utilisateur + rôles + permissions. */
export async function obtenirProfilComplet(id) {
  const utilisateur = await obtenirUtilisateur(id);
  if (!utilisateur) return null;

  const { rows } = await query(
    'SELECT code_permission FROM fn_permissions_utilisateur($1) ORDER BY code_permission',
    [id]
  );

  // Portée : la direction et les fonctions de contrôle voient tout le groupe ;
  // les autres comptes restent limités à leur pharmacie de rattachement.
  const ROLES_GLOBAUX = ['DG', 'DGA', 'COMPTABLE', 'DIR_TECHNIQUE', 'TRESORIER', 'AUDITEUR'];
  const codesRoles = (utilisateur.roles ?? []).map((role) => role.code);
  const porteeGlobale = Boolean(utilisateur.superAdmin) || codesRoles.some((c) => ROLES_GLOBAUX.includes(c));

  return {
    ...utilisateur,
    pointVenteId: utilisateur.pointVente?.id ?? null,
    pointVenteCode: utilisateur.pointVente?.code ?? null,
    pointVenteNom: utilisateur.pointVente?.nom ?? null,
    // Type de la pharmacie de rattachement : sert a distinguer une succursale
    // (qui possede son fournisseur principal « Pharmacie du Siege ») du siege,
    // du magasin ou d'un compte sans rattachement.
    pointVenteType: utilisateur.pointVente?.typePoint ?? null,
    porteeGlobale,
    permissions: rows.map((ligne) => ligne.code_permission),
  };
}