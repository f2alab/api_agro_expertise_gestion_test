
// Gestion des mots de passe : hachage bcrypt (déporté dans un pool de threads,
// voir utils/hachage.js) et génération de mots de passe provisoires robustes.

import crypto from 'node:crypto';

// Ré-export : le reste de l'application continue d'utiliser ces deux fonctions.
export { hacherMotDePasse, verifierMotDePasse } from './hachage.js';

const MAJUSCULES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULES = 'abcdefghijkmnopqrstuvwxyz';
const CHIFFRES = '23456789';
const SPECIAUX = '!@#$%&*?';
const TOUS = MAJUSCULES + MINUSCULES + CHIFFRES + SPECIAUX;

const tirerCaractere = (alphabet) => alphabet[crypto.randomInt(alphabet.length)];

/**
 * Génère un mot de passe provisoire respectant la politique de sécurité
 * (au moins une majuscule, une minuscule, un chiffre et un caractère spécial).
 */
export function genererMotDePasseProvisoire(longueur = 12) {
  const obligatoires = [
    tirerCaractere(MAJUSCULES),
    tirerCaractere(MINUSCULES),
    tirerCaractere(CHIFFRES),
    tirerCaractere(SPECIAUX),
  ];
  const complement = Array.from({ length: Math.max(longueur - obligatoires.length, 0) }, () =>
    tirerCaractere(TOUS)
  );
  // Mélange de Fisher-Yates pour éviter une position prévisible des caractères
  const caracteres = [...obligatoires, ...complement];
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join('');
}