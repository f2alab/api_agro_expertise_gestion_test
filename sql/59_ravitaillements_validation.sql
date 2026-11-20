-- =============================================================================
-- GAE - ERP : 59_ravitaillements_validation.sql
-- Demandes de ravitaillement du magasin central soumises a validation.
--
-- Regles metier :
--   * le magasin (ou le directeur technique) ne transfere plus le stock
--     immediatement : il enregistre une DEMANDE de ravitaillement ;
--   * la demande est approuvee ou rejetee par la direction (DG / DGA) ;
--   * seule l'approbation execute reellement les mouvements de stock (sortie
--     du magasin / entree dans la pharmacie, lot par lot en FEFO) ;
--   * une demande peut etre rattachee a une commande ENVOYEE d'une pharmacie
--     dont le fournisseur est la « Pharmacie du Siege » (magasin central) :
--     l'approbation solde alors les lignes de la commande et cree la reception
--     correspondante ;
--   * tant qu'une demande liee a une commande est en attente, la reception de
--     cette commande est interdite (l'entree de stock ne doit pas etre
--     comptabilisee deux fois).
--
-- A executer APRES 58_fournisseurs_principal_succursales.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Entete d'une demande de ravitaillement.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacie_demandes_ravitaillement (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               VARCHAR(40) NOT NULL UNIQUE,
  magasin_id           UUID NOT NULL REFERENCES pharmacie_points(id) ON DELETE RESTRICT,
  point_destination_id UUID NOT NULL REFERENCES pharmacie_points(id) ON DELETE RESTRICT,
  -- Commande d'origine (facultative) : demande saisie manuellement ou chargee
  -- depuis une commande ENVOYEE de la pharmacie de destination.
  commande_id          UUID REFERENCES pharmacie_commandes(id) ON DELETE SET NULL,
  statut               VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
  commentaire          TEXT,
  motif_rejet          TEXT,
  demande_par          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par           UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_le            TIMESTAMPTZ,
  cree_le              TIMESTAMPTZ NOT NULL DEFAULT now(),
  maj_le               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_demande_ravitaillement_statut CHECK (
    statut IN ('EN_ATTENTE','APPROUVE','REJETE')
  )
);

COMMENT ON TABLE pharmacie_demandes_ravitaillement IS
  'Demandes de ravitaillement du magasin central, soumises a validation (DG / DGA).';

CREATE INDEX IF NOT EXISTS idx_pharmacie_demandes_ravitaillement_statut
  ON pharmacie_demandes_ravitaillement(statut, cree_le DESC);

CREATE INDEX IF NOT EXISTS idx_pharmacie_demandes_ravitaillement_destination
  ON pharmacie_demandes_ravitaillement(point_destination_id);

-- Une seule demande en attente par commande : evite de transferer deux fois
-- les memes lignes. Une demande rejetee libere la commande.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pharmacie_demandes_ravitaillement_commande_attente
  ON pharmacie_demandes_ravitaillement(commande_id)
  WHERE statut = 'EN_ATTENTE' AND commande_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Lignes de la demande (produit, quantite demandee et quantite transferee).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacie_demandes_ravitaillement_lignes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ravitailement_id    UUID NOT NULL REFERENCES pharmacie_demandes_ravitaillement(id) ON DELETE CASCADE,
  produit_id          UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE RESTRICT,
  -- Ligne de commande d'origine (mode « a partir d'une commande »).
  commande_ligne_id   UUID REFERENCES pharmacie_commandes_lignes(id) ON DELETE SET NULL,
  quantite            INTEGER NOT NULL,
  quantite_transferee INTEGER NOT NULL DEFAULT 0,
  prix_unitaire       NUMERIC(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT ck_pharmacie_demande_ravitaillement_ligne_quantite CHECK (quantite > 0)
);

COMMENT ON TABLE pharmacie_demandes_ravitaillement_lignes IS
  'Produits et quantites d''une demande de ravitaillement du magasin.';

CREATE INDEX IF NOT EXISTS idx_pharmacie_demandes_ravitaillement_lignes_demande
  ON pharmacie_demandes_ravitaillement_lignes(ravitailement_id);
-- -----------------------------------------------------------------------------
-- 3. Permission de validation des demandes (DG / DGA).
--    Le magasin (DIR_TECHNIQUE) conserve `pharmacie.magasin.transfert` pour
--    creer les demandes ; il ne peut pas les approuver lui-meme.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('pharmacie.magasin.transfert.valider',
   'pharmacie',
   'magasin',
   'validate',
   'Valider les ravitaillements',
   'Approuver ou rejeter les demandes de ravitaillement du magasin central (DG / DGA)')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Attribution : direction generale uniquement (DG, DGA) + super administrateur.
-- -----------------------------------------------------------------------------
WITH attributions (role_code, permission_code) AS (VALUES
  ('DG',          'pharmacie.magasin.transfert.valider'),
  ('DGA',         'pharmacie.magasin.transfert.valider'),
  ('SUPER_ADMIN', 'pharmacie.magasin.transfert.valider')
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.code = a.permission_code
ON CONFLICT DO NOTHING;

-- Le responsable de pharmacie n'accede pas au magasin central : on retire toute
-- attribution eventuelle (le seed `pharmacie.%` pourrait la lui redonner).
DELETE FROM roles_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'RESP_PHARMACIE'
  AND p.code = 'pharmacie.magasin.transfert.valider';