-- 41_pharmacie_reglements.sql
-- Reglements des factures fournisseurs des commandes d'approvisionnement.
--
-- Chaque ligne est un versement (especes, mobile money, virement...) rattache a
-- une commande. Le montant paye d'une commande est la somme de ses reglements ;
-- compare au total TTC, il donne le reste a payer (suivi des impayes
-- fournisseurs, affiche dans la liste des commandes et sur le bon de commande).
--
-- Une reception de commande enregistre automatiquement un reglement lorsque le
-- montant de la facture fournisseur est saisi (colonne `reception_id`).
--
-- Script rejouable (idempotent).

CREATE TABLE IF NOT EXISTS pharmacie_reglements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id    UUID NOT NULL REFERENCES pharmacie_commandes(id)  ON DELETE CASCADE,
  -- Reception a l'origine du reglement (NULL pour un versement saisi a la main).
  reception_id   UUID REFERENCES pharmacie_receptions(id) ON DELETE SET NULL,
  date_reglement DATE NOT NULL DEFAULT CURRENT_DATE,
  montant        NUMERIC(14,2) NOT NULL,
  mode           VARCHAR(20) NOT NULL DEFAULT 'ESPECES',
  reference      VARCHAR(80),
  commentaire    TEXT,
  cree_par       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pharmacie_reglement_montant CHECK (montant > 0),
  CONSTRAINT ck_pharmacie_reglement_mode CHECK (
    mode IN ('ESPECES','MOBILE_MONEY','CHEQUE','VIREMENT','CARTE','CREDIT')
  )
);

COMMENT ON TABLE pharmacie_reglements IS 'Reglements des factures fournisseurs (commandes d''approvisionnement).';

CREATE INDEX IF NOT EXISTS idx_pharmacie_reglements_commande
  ON pharmacie_reglements(commande_id);

CREATE INDEX IF NOT EXISTS idx_pharmacie_reglements_date
  ON pharmacie_reglements(date_reglement);

-- Un seul reglement par reception : rend la reprise ci-dessous rejouable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacie_reglements_reception
  ON pharmacie_reglements(reception_id);

-- Reprise des donnees existantes : la facture declaree a la reception etait
-- jusqu'ici consideree comme reglee (c'est elle qui creait l'ecriture ACHAT).
INSERT INTO pharmacie_reglements
  (commande_id, reception_id, date_reglement, montant, mode, reference, commentaire, cree_par, cree_le)
SELECT r.commande_id,
       r.id,
       r.date_reception,
       r.montant_facture,
       'ESPECES',
       r.numero_facture,
       'Reprise de la facture de reception',
       r.recepteur_id,
       r.cree_le
  FROM pharmacie_receptions r
 WHERE r.montant_facture > 0
ON CONFLICT (reception_id) DO NOTHING;