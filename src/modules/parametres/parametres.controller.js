// Controleur des parametres applicatifs.
//
// Regle particuliere : les reglages d'affichage discret (`affichage.discret.*`)
// ne sont modifiables que par la Direction Generale (permission
// `parametres.affichage.update`), alors que le reste des parametres suit la
// permission generale `parametres.systeme.update`.

import { succes } from '../../utils/reponses.js';
import { ApiError } from '../../utils/apiError.js';
import { enregistrerAudit } from '../audit/audit.service.js';
import * as service from './parametres.service.js';

/** Permission reservee au reglage de l'affichage discret (Direction Generale). */
const PERMISSION_AFFICHAGE_DISCRET = 'parametres.affichage.update';

/**
 * Permission reservee a la revision du tarif de consultation de la clinique.
 * Detenue par la Direction (DG, DGA) et le Directeur Technique : le tarif
 * s'applique a tous les passages, il ne doit pas dependre du profil d'accueil.
 */
const PERMISSION_FRAIS_CLINIQUE = 'clinique.frais.update';

/** Prefixe des reglages du parcours de consultation de la clinique. */
const PREFIXE_FRAIS_CLINIQUE = 'clinique.consultation.';

/** Vrai si la cle regle le parcours de consultation (dont le tarif). */
function estCleFraisClinique(cle) {
  return typeof cle === 'string' && cle.startsWith(PREFIXE_FRAIS_CLINIQUE);
}

/** Vrai si l'utilisateur est habilite a reviser le tarif de consultation. */
function peutGererFraisClinique(utilisateur) {
  if (!utilisateur) return false;
  if (utilisateur.superAdmin) return true;
  return (utilisateur.permissions ?? []).includes(PERMISSION_FRAIS_CLINIQUE);
}

/** Vrai si l'utilisateur est habilite a regler l'affichage discret. */
export function peutGererAffichageDiscret(utilisateur) {
  if (!utilisateur) return false;
  if (utilisateur.superAdmin) return true;
  return (utilisateur.permissions ?? []).includes(PERMISSION_AFFICHAGE_DISCRET);
}

/** GET /api/parametres */
export async function lister(req, res) {
  return succes(
    res,
    await service.listerParametres({
      inclureAffichageDiscret: peutGererAffichageDiscret(req.utilisateur),
    })
  );
}

/** GET /api/parametres/publics (tout profil authentifie) */
export async function publics(req, res) {
  return succes(res, await service.lireParametresPublics());
}

/** PUT /api/parametres/:cle */
export async function modifier(req, res) {
  const cle = req.params.cle;

  if (estCleFraisClinique(cle) && !peutGererFraisClinique(req.utilisateur)) {
    throw ApiError.forbidden(
      'Seule la Direction (DG, DGA) et le Directeur Technique peuvent modifier le tarif de consultation.',
      'PERMISSION_REFUSEE',
      { permissionsRequises: [PERMISSION_FRAIS_CLINIQUE] }
    );
  }

  // Le facteur d'affichage discret est reserve a la Direction Generale : il
  // masque les montants de tous les ecrans, il ne doit pas pouvoir etre change
  // depuis un profil qui dispose seulement de `parametres.systeme.update`.
  if (service.estCleAffichageDiscret(cle) && !peutGererAffichageDiscret(req.utilisateur)) {
    throw ApiError.forbidden(
      "Seule la Direction Generale peut regler l'affichage discret des montants.",
      'PERMISSION_REFUSEE',
      { permissionsRequises: [PERMISSION_AFFICHAGE_DISCRET] }
    );
  }

  const parametre = await service.ecrireParametre(cle, req.valide.valeur, req.utilisateur.id);

  await enregistrerAudit({
    action: 'MODIFICATION_PARAMETRE',
    module: 'parametres',
    entite: 'parametre',
    entiteId: parametre.cle,
    utilisateurId: req.utilisateur.id,
    acteurEmail: req.utilisateur.email,
    req,
    details: { cle: parametre.cle, valeur: parametre.valeur },
  });

  return succes(res, parametre);
}