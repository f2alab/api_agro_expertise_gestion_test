
// Réponses HTTP normalisées.
// Toutes les réponses de succès ont la forme : { succes: true, donnees: ... }
// Toutes les erreurs ont la forme              : { succes: false, erreur: {...} }


/** Réponse de succès. */
export const succes = (res, donnees, statut = 200) =>
  res.status(statut).json({ succes: true, donnees });

/** Réponse de création (201) avec en-tête Location optionnel. */
export const cree = (res, donnees, chemin = null) => {
  if (chemin) res.setHeader('Location', chemin);
  return res.status(201).json({ succes: true, donnees });
};

/** Réponse sans contenu (204). */
export const sansContenu = (res) => res.status(204).end();

/**
 * Réponse binaire (image stockée en base) avec mise en cache par ETag.
 *
 * L'empreinte SHA-256 du contenu sert d'ETag : tant que la photo n'a pas
 * changé, le navigateur reçoit une réponse 304 et ne retélécharge rien.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{contenu: Buffer, typeMime: string, tailleOctets: number, empreinte: string}} image
 */
export const image = (req, res, donneesImage) => {
  const etag = `"${donneesImage.empreinte}"`;
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('ETag', etag);

  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  res.setHeader('Content-Type', donneesImage.typeMime);
  res.setHeader('Content-Length', donneesImage.tailleOctets);
  return res.send(donneesImage.contenu);
};