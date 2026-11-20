
// Écriture au grand livre (finance_transactions).
// Ce module est la seule porte d'entrée pour enregistrer un mouvement d'argent.
// Il est utilisable dans une transaction existante (client pg) pour rester
// cohérent avec l'opération métier d'origine (vente, réception, dépense...).

import { randomUUID } from 'node:crypto';
import { query } from '../../config/database.js';
import { ApiError } from '../../utils/apiError.js';

/** Génère un numéro de flux unique (FLX-AAAAMMJJ-XXXX). */
export function genererNumeroFlux(prefixe = 'FLX') {
  const maintenant = new Date();
  const jour = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}${String(
    maintenant.getDate()
  ).padStart(2, '0')}`;
  return `${prefixe}-${jour}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

/**
 * Enregistre une écriture au grand livre.
 *
 * @param {object} flux
 * @param {string} [flux.serviceId]  service financier (sinon déduit du point)
 * @param {string} [flux.pointId]    pharmacie concernée (dénormalisé)
* @param {string} [flux.compteId]   compte de paiement mouvementé (mobile money / banque)
 * @param {'ENTREE'|'SORTIE'} flux.sens
 * @param {string}  flux.categorie   VENTE, ACHAT, DEPENSE, APPORT...
 * @param {string}  flux.mode        ESPECES, MOBILE_MONEY, CHEQUE, VIREMENT...
 * @param {number}  flux.montant
 * @param {string}  [flux.libelle]
 * @param {string}  [flux.referenceType]
 * @param {string}  [flux.referenceId]
 * @param {string}  [flux.effectuePar] identifiant de l'utilisateur
 * @param {object} [client]          client pg d'une transaction en cours
 * @returns {Promise<string>} identifiant de l'écriture créée
 */
export async function enregistrerFlux(flux, client = null) {
  const executer = (texte, parametres) =>
    client ? client.query(texte, parametres) : query(texte, parametres);

  let serviceId = flux.serviceId ?? null;
  if (!serviceId && flux.pointId) {
    const { rows } = await executer('SELECT fn_finance_service_point($1) AS id', [flux.pointId]);
    serviceId = rows[0]?.id ?? null;
  }
  if (!serviceId) {
    throw ApiError.badRequest(
      'Service financier indéterminé : renseignez le service ou la pharmacie.',
      'SERVICE_FINANCE_REQUIS'
    );
  }

  const { rows } = await executer(
    `INSERT INTO finance_transactions
       (numero, service_id, point_id, compte_id, sens, categorie, mode, montant, libelle,
        reference_type, reference_id, effectue_par, date_transaction)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::timestamptz, now()))
     RETURNING id`,
    [
      genererNumeroFlux(),
      serviceId,
      flux.pointId ?? null,
      flux.compteId ?? null,
      flux.sens,
      flux.categorie ?? 'AUTRE',
      flux.mode ?? 'ESPECES',
      flux.montant ?? 0,
      flux.libelle ?? null,
      flux.referenceType ?? null,
      flux.referenceId ?? null,
      flux.effectuePar ?? null,
      flux.dateTransaction ?? null,
    ]
  );

  return rows[0].id;
}
