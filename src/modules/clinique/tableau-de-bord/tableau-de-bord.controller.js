// Contrôleur du tableau de bord de la clinique.

import { succes } from '../../../utils/reponses.js';
import * as service from './tableau-de-bord.service.js';

/** Vrai si le profil peut consulter les factures de la clinique. */
function peutVoirFactures(utilisateur) {
  if (!utilisateur) return false;
  if (utilisateur.superAdmin) return true;
  return (utilisateur.permissions ?? []).includes('clinique.factures.read');
}

/** GET /api/clinique/tableau-de-bord */
export async function indicateurs(req, res) {
  const donnees = await service.indicateursClinique(req.valide);

  // Les montants de facturation ne sont renvoyes qu'aux profils habilites a
  // consulter les factures : l'agent d'accueil clinique, par exemple, ne les
  // voit pas (le bloc est mis a null et l'ecran masque la carte).
  if (!peutVoirFactures(req.utilisateur)) donnees.factures = null;

  return succes(res, donnees);
}