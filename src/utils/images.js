
// Lecture et validation des images envoyées par le navigateur.
//
// Les photos de profil arrivent en base64 dans un corps JSON (le projet
// n'utilise aucune bibliothèque multipart) : le frontend compresse l'image
// dans un <canvas> avant l'envoi, puis le serveur la décode ici.
//
// Sécurité : le type MIME déclaré par le client n'est JAMAIS cru sur parole.
// Le type réel est déduit des premiers octets du fichier (signature binaire),
// ce qui empêche de déposer un exécutable ou une page HTML dans la base.

import { createHash } from 'node:crypto';
import { ApiError } from './apiError.js';

/** Taille maximale d'une photo telle qu'acceptée par l'API (512 Ko). */
export const TAILLE_MAX_PHOTO_OCTETS = 512 * 1024;

/**
 * Taille maximale de la chaîne base64 transmise. Le corps JSON est plafonné à
 * 1 Mo par `express.json` : 512 Ko binaires représentent ~683 000 caractères,
 * ce qui laisse de la marge pour l'enveloppe JSON.
 */
export const TAILLE_MAX_PHOTO_BASE64 = 720_000;

/** Types d'images acceptés (whitelist appliquée en base et par l'API). */
export const TYPES_PHOTO_AUTORISES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Résolution maximale acceptée (côté le plus long, en pixels).
 *
 * Le navigateur recadre déjà la photo en carré 512 px ; cette limite
 * volontairement large protège la base contre un envoi direct par un client
 * tiers : seules des images de résolution moyenne sont conservées.
 */
export const DIMENSION_MAX_IMAGE = 2000;

/** Préfixe d'une image encodée en Data URL (« data:image/png;base64,... »). */
const PREFIXE_DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+)?;base64,/i;

/** Contenu base64 valide (alphabet standard, remplissage correct). */
const BASE64_VALIDE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Déduit le type MIME réel d'une image à partir de sa signature binaire.
 * @param {Buffer} tampon
 * @returns {string|null} type MIME, ou null si l'image n'est pas reconnue
 */
export function detecterTypeImage(tampon) {
  if (!tampon || tampon.length < 12) return null;

  // JPEG : FF D8 FF
  if (tampon[0] === 0xff && tampon[1] === 0xd8 && tampon[2] === 0xff) return 'image/jpeg';

  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (
    tampon[0] === 0x89 &&
    tampon[1] === 0x50 &&
    tampon[2] === 0x4e &&
    tampon[3] === 0x47 &&
    tampon[4] === 0x0d &&
    tampon[5] === 0x0a &&
    tampon[6] === 0x1a &&
    tampon[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP : « RIFF » .... « WEBP »
  if (tampon.toString('ascii', 0, 4) === 'RIFF' && tampon.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // GIF : « GIF87a » ou « GIF89a »
  if (tampon.toString('ascii', 0, 6) === 'GIF87a' || tampon.toString('ascii', 0, 6) === 'GIF89a') {
    return 'image/gif';
  }

  return null;
}

/**
 * Lit les dimensions réelles d'une image dans son en-tête.
 *
 * Objectif : ne jamais faire confiance à une résolution annoncée par le client.
 * Les en-têtes sont lus en mode défensif - un fichier inattendu renvoie `null`
 * (les dimensions restent alors inconnues) plutôt que de lever une erreur.
 *
 * @param {Buffer} contenu octets de l'image
 * @param {string} typeMime type déduit de la signature binaire
 * @returns {{ largeur: number, hauteur: number }|null}
 */
export function lireDimensionsImage(contenu, typeMime) {
  try {
    if (typeMime === 'image/png') return dimensionsPng(contenu);
    if (typeMime === 'image/jpeg') return dimensionsJpeg(contenu);
    if (typeMime === 'image/webp') return dimensionsWebp(contenu);
    if (typeMime === 'image/gif') {
      return { largeur: contenu.readUInt16LE(6), hauteur: contenu.readUInt16LE(8) };
    }
  } catch {
    // En-tête incomplet : dimensions inconnues, l'image reste acceptée.
  }
  return null;
}

/** PNG : bloc IHDR, largeur et hauteur en entiers 32 bits (octets 16 et 20). */
function dimensionsPng(tampon) {
  if (tampon.length < 24) return null;
  return { largeur: tampon.readUInt32BE(16), hauteur: tampon.readUInt32BE(20) };
}

/**
 * JPEG : parcours des segments jusqu'au premier « début de trame » (SOF0..SOF15),
 * qui porte hauteur puis largeur sur 16 bits.
 */
function dimensionsJpeg(tampon) {
  let position = 2; // après le marqueur SOI (FF D8)

  while (position + 9 < tampon.length) {
    if (tampon[position] !== 0xff) {
      position += 1; // resynchronisation sur un éventuel remplissage
      continue;
    }

    const marqueur = tampon[position + 1];

    // Remplissage FF FF, marqueur TEM (01) et marqueurs autonomes D0..D9 :
    // aucun champ de longueur, on avance de deux octets.
    if (marqueur === 0xff || marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd9)) {
      position += 2;
      continue;
    }

    // SOS : début des données compressées, les dimensions ont déjà été vues.
    if (marqueur === 0xda) break;

    const longueur = tampon.readUInt16BE(position + 2);
    if (longueur < 2) break;

    const debutDeTrame =
      marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur);

    if (debutDeTrame) {
      // SOF : longueur (2), précision (1), hauteur (2), largeur (2)
      return {
        hauteur: tampon.readUInt16BE(position + 5),
        largeur: tampon.readUInt16BE(position + 7),
      };
    }

    position += 2 + longueur;
  }

  return null;
}

/** WebP : canevas étendu (VP8X), flux avec pertes (VP8) ou sans pertes (VP8L). */
function dimensionsWebp(tampon) {
  const format = tampon.toString('ascii', 12, 16);

  // VP8X : largeur et hauteur sur 3 octets little-endian, moins 1.
  if (format === 'VP8X') {
    return { largeur: tampon.readUIntLE(24, 3) + 1, hauteur: tampon.readUIntLE(27, 3) + 1 };
  }

  // VP8 (avec pertes) : code de synchronisation 0x9D 0x01 0x2A puis 14 bits utiles.
  if (format === 'VP8 ') {
    if (tampon[23] !== 0x9d || tampon[24] !== 0x01 || tampon[25] !== 0x2a) return null;
    return {
      largeur: tampon.readUInt16LE(26) & 0x3fff,
      hauteur: tampon.readUInt16LE(28) & 0x3fff,
    };
  }

  // VP8L (sans pertes) : signature 0x2F puis 14 bits (largeur - 1) et 14 bits (hauteur - 1).
  if (format === 'VP8L') {
    const bits = tampon.readUInt32LE(21);
    return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
  }

  return null;
}

/**
 * Décode une photo reçue en base64 et vérifie son intégrité.
 *
 * @param {string} valeur Chaîne base64 (Data URL acceptée et nettoyée)
 * @returns {{ contenu: Buffer, typeMime: string, tailleOctets: number,
 *             largeur: number|null, hauteur: number|null }}
 * @throws {ApiError} 400 si le contenu est vide, trop lourd, trop grand ou de
 *                    type refusé
 */
export function decoderPhotoBase64(valeur) {
  const nettoyee = String(valeur ?? '').trim().replace(PREFIXE_DATA_URL, '');

  if (!nettoyee) {
    throw ApiError.badRequest('La photo transmise est vide.', 'PHOTO_VIDE', { champ: 'contenuBase64' });
  }
  if (nettoyee.length > TAILLE_MAX_PHOTO_BASE64) {
    throw ApiError.badRequest(
      'La photo est trop volumineuse : 512 Ko maximum.',
      'PHOTO_TROP_VOLUMINEUSE',
      { champ: 'contenuBase64', maximumOctets: TAILLE_MAX_PHOTO_OCTETS }
    );
  }
  if (!BASE64_VALIDE.test(nettoyee)) {
    throw ApiError.badRequest(
      "La photo n'est pas encodée en base64 valide.",
      'PHOTO_MAL_ENCODEE',
      { champ: 'contenuBase64' }
    );
  }

  const contenu = Buffer.from(nettoyee, 'base64');
  if (contenu.length === 0) {
    throw ApiError.badRequest('La photo transmise est vide.', 'PHOTO_VIDE', { champ: 'contenuBase64' });
  }
  if (contenu.length > TAILLE_MAX_PHOTO_OCTETS) {
    throw ApiError.badRequest(
      'La photo est trop volumineuse : 512 Ko maximum.',
      'PHOTO_TROP_VOLUMINEUSE',
      { champ: 'contenuBase64', maximumOctets: TAILLE_MAX_PHOTO_OCTETS }
    );
  }

  // Le type déclaré par le client est ignoré : seule la signature binaire fait foi.
  const typeMime = detecterTypeImage(contenu);
  if (!typeMime) {
    throw ApiError.badRequest(
      'Format d’image non reconnu : utilisez une image JPEG, PNG, WebP ou GIF.',
      'PHOTO_FORMAT_INVALIDE',
      { champ: 'contenuBase64', formatsAcceptes: TYPES_PHOTO_AUTORISES }
    );
  }

  // Dimensions lues dans l'en-tête : elles ne sont jamais déclarées par le
  // client, qui pourrait annoncer n'importe quoi.
  const dimensions = lireDimensionsImage(contenu, typeMime);
  if (
    dimensions &&
    (dimensions.largeur > DIMENSION_MAX_IMAGE || dimensions.hauteur > DIMENSION_MAX_IMAGE)
  ) {
    throw ApiError.badRequest(
      `Image trop grande (${dimensions.largeur} × ${dimensions.hauteur} px) : ${DIMENSION_MAX_IMAGE} px maximum par côté.`,
      'PHOTO_DIMENSIONS_INVALIDE',
      { champ: 'contenuBase64', maximumPixels: DIMENSION_MAX_IMAGE }
    );
  }

  return {
    contenu,
    typeMime,
    tailleOctets: contenu.length,
    largeur: dimensions?.largeur ?? null,
    hauteur: dimensions?.hauteur ?? null,
  };
}

/**
 * Empreinte SHA-256 d'une photo, exposée en ETag HTTP.
 * @param {Buffer} tampon
 * @returns {string} empreinte hexadécimale (64 caractères)
 */
export function creerEmpreinte(tampon) {
  return createHash('sha256').update(tampon).digest('hex');
}
