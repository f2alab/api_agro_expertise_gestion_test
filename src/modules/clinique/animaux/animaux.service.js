// Service des fiches animaux et du dossier médical.

import { query } from '../../../config/database.js';
import { ApiError } from '../../../utils/apiError.js';
import { exigerProprietaire } from '../proprietaires/proprietaires.service.js';
import { genererNumero } from '../clinique.service.js';

// Fiche animal + propriétaire + statistiques de suivi.
const SELECT_ANIMAL = `
  SELECT a.id, a.code, a.proprietaire_id, a.nom, a.espece, a.race, a.sexe,
         a.date_naissance, a.age_estime, a.poids_kg, a.robe, a.identification,
         a.signes_particuliers, a.statut, a.created_at, a.updated_at,
         p.code AS proprietaire_code, p.nom AS proprietaire_nom,
         p.telephone AS proprietaire_telephone,
         (SELECT count(*)::int FROM clinique_consultations c WHERE c.animal_id = a.id)     AS nb_consultations,
         (SELECT max(c.accueil_le) FROM clinique_consultations c WHERE c.animal_id = a.id) AS derniere_consultation,
         (SELECT count(*)::int FROM clinique_ordonnances o WHERE o.animal_id = a.id)       AS nb_ordonnances
  FROM clinique_animaux a
  JOIN clinique_proprietaires p ON p.id = a.proprietaire_id
`;

/** Transforme une ligne SQL en objet API. */
export function serialiserAnimal(ligne) {
  if (!ligne) return null;
  return {
    id: ligne.id,
    code: ligne.code,
    proprietaireId: ligne.proprietaire_id,
    proprietaireCode: ligne.proprietaire_code ?? null,
    proprietaireNom: ligne.proprietaire_nom ?? null,
    proprietaireTelephone: ligne.proprietaire_telephone ?? null,
    nom: ligne.nom ?? null,
    espece: ligne.espece,
    race: ligne.race ?? null,
    sexe: ligne.sexe,
    dateNaissance: ligne.date_naissance ?? null,
    ageEstime: ligne.age_estime ?? null,
    poidsKg: ligne.poids_kg === null || ligne.poids_kg === undefined ? null : Number(ligne.poids_kg),
    robe: ligne.robe ?? null,
    identification: ligne.identification ?? null,
    signesParticuliers: ligne.signes_particuliers ?? null,
    statut: ligne.statut,
    nbConsultations: ligne.nb_consultations ?? 0,
    nbOrdonnances: ligne.nb_ordonnances ?? 0,
    derniereConsultation: ligne.derniere_consultation ?? null,
    creeLe: ligne.created_at,
    majLe: ligne.updated_at,
  };
}

/** Liste les animaux (recherche nom/code, propriétaire, espèce, statut). */
export async function listerAnimaux(filtres = {}) {
  const conditions = [];
  const parametres = [];

  if (filtres.recherche) {
    parametres.push(`%${filtres.recherche}%`);
    const i = parametres.length;
    conditions.push(
      `(a.nom ILIKE $${i} OR a.code ILIKE $${i} OR p.nom ILIKE $${i} OR a.identification ILIKE $${i})`
    );
  }
  if (filtres.proprietaireId) {
    parametres.push(filtres.proprietaireId);
    conditions.push(`a.proprietaire_id = $${parametres.length}`);
  }
  if (filtres.espece) {
    parametres.push(filtres.espece);
    conditions.push(`a.espece = $${parametres.length}`);
  }
  if (filtres.statut) {
    parametres.push(filtres.statut);
    conditions.push(`a.statut = $${parametres.length}`);
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const tri = filtres.ordre === 'recent' ? 'a.created_at DESC' : 'a.nom ASC NULLS LAST, a.code ASC';
  const { rows } = await query(`${SELECT_ANIMAL} ${clause} ORDER BY ${tri} LIMIT 500`, parametres);
  return rows.map(serialiserAnimal);
}

/** Récupère un animal ou null. */
export async function obtenirAnimal(id) {
  const { rows } = await query(`${SELECT_ANIMAL} WHERE a.id = $1`, [id]);
  return rows[0] ? serialiserAnimal(rows[0]) : null;
}

/** Récupère un animal ou lève une 404. */
export async function exigerAnimal(id) {
  const animal = await obtenirAnimal(id);
  if (!animal) throw ApiError.notFound('Animal introuvable.', 'ANIMAL_INTROUVABLE');
  return animal;
}

/** Crée une fiche animal (code attribué automatiquement). */
export async function creerAnimal(donnees, utilisateur = null) {
  await exigerProprietaire(donnees.proprietaireId);
  const code = await genererNumero('ANI', { avecAnnee: false });

  const { rows } = await query(
    `INSERT INTO clinique_animaux
       (code, proprietaire_id, nom, espece, race, sexe, date_naissance, age_estime,
        poids_kg, robe, identification, signes_particuliers, statut, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      code,
      donnees.proprietaireId,
      donnees.nom ?? null,
      donnees.espece.trim(),
      donnees.race ?? null,
      donnees.sexe ?? 'INCONNU',
      donnees.dateNaissance || null,
      donnees.ageEstime ?? null,
      donnees.poidsKg ?? null,
      donnees.robe ?? null,
      donnees.identification ?? null,
      donnees.signesParticuliers ?? null,
      donnees.statut ?? 'VIVANT',
      utilisateur?.id ?? null,
    ]
  );

  return obtenirAnimal(rows[0].id);
}

/** Modifie partiellement une fiche animal. */
export async function modifierAnimal(id, donnees) {
  await exigerAnimal(id);

  const champs = [];
  const valeurs = [];
  const ajouter = (colonne, valeur) => {
    valeurs.push(valeur);
    champs.push(`${colonne} = $${valeurs.length}`);
  };

  const correspondances = {
    nom: 'nom',
    espece: 'espece',
    race: 'race',
    sexe: 'sexe',
    ageEstime: 'age_estime',
    poidsKg: 'poids_kg',
    robe: 'robe',
    identification: 'identification',
    signesParticuliers: 'signes_particuliers',
    statut: 'statut',
  };
  for (const [cle, colonne] of Object.entries(correspondances)) {
    if (donnees[cle] !== undefined) ajouter(colonne, donnees[cle] === '' ? null : donnees[cle]);
  }
  if (donnees.dateNaissance !== undefined) ajouter('date_naissance', donnees.dateNaissance || null);

  if (champs.length > 0) {
    valeurs.push(id);
    await query(`UPDATE clinique_animaux SET ${champs.join(', ')} WHERE id = $${valeurs.length}`, valeurs);
  }

  return obtenirAnimal(id);
}

/** Archive un animal (statut DEPLACE) sans supprimer son dossier médical. */
export async function desactiverAnimal(id) {
  const animal = await exigerAnimal(id);
  await query("UPDATE clinique_animaux SET statut = 'DEPLACE' WHERE id = $1", [id]);
  return { id, code: animal.code, nom: animal.nom, statut: 'DEPLACE' };
}

/**
 * Dossier médical complet : identité, historique des consultations (avec
 * diagnostics), ordonnances et factures. C'est la vue de traçabilité demandée
 * pour chaque animal.
 */
export async function dossierMedical(id) {
  const animal = await exigerAnimal(id);

  const [consultations, ordonnances, factures] = await Promise.all([
    query(
      `SELECT c.id, c.numero, c.statut, c.motif, c.type_consultation, c.accueil_le,
              c.consultation_fin, c.conclusion, c.pronostic, c.frais_consultation, c.frais_payes,
              (u.nom || ' ' || u.prenom) AS veterinaire_nom,
              (SELECT string_agg(d.libelle, ', ' ORDER BY d.cree_le)
                 FROM clinique_diagnostics d WHERE d.consultation_id = c.id) AS diagnostics
       FROM clinique_consultations c
       LEFT JOIN utilisateurs u ON u.id = c.veterinaire_id
       WHERE c.animal_id = $1
       ORDER BY c.accueil_le DESC`,
      [id]
    ),
    query(
      `SELECT o.id, o.numero, o.statut, o.created_at,
              (SELECT count(*)::int FROM clinique_ordonnances_lignes l
                WHERE l.ordonnance_id = o.id) AS nb_lignes,
              (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0)
                 FROM clinique_ordonnances_lignes l WHERE l.ordonnance_id = o.id) AS montant
       FROM clinique_ordonnances o
       WHERE o.animal_id = $1
       ORDER BY o.created_at DESC`,
      [id]
    ),
    query(
      `SELECT f.id, f.numero, f.statut, f.montant_total, f.total_paye,
              f.reste_a_payer, f.date_facture
       FROM clinique_factures f
       WHERE f.animal_id = $1
       ORDER BY f.date_facture DESC`,
      [id]
    ),
  ]);

  return {
    animal,
    consultations: consultations.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      statut: ligne.statut,
      motif: ligne.motif,
      typeConsultation: ligne.type_consultation,
      accueilLe: ligne.accueil_le,
      finLe: ligne.consultation_fin,
      conclusion: ligne.conclusion,
      pronostic: ligne.pronostic,
      fraisConsultation: Number(ligne.frais_consultation ?? 0),
      fraisPayes: Boolean(ligne.frais_payes),
      veterinaireNom: ligne.veterinaire_nom ?? null,
      diagnostics: ligne.diagnostics ?? null,
    })),
    ordonnances: ordonnances.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      statut: ligne.statut,
      emiseLe: ligne.created_at,
      nbLignes: ligne.nb_lignes ?? 0,
      montant: Number(ligne.montant ?? 0),
    })),
    factures: factures.rows.map((ligne) => ({
      id: ligne.id,
      numero: ligne.numero,
      statut: ligne.statut,
      montantTotal: Number(ligne.montant_total ?? 0),
      totalPaye: Number(ligne.total_paye ?? 0),
      resteAPayer: Number(ligne.reste_a_payer ?? 0),
      dateFacture: ligne.date_facture,
    })),
  };
}