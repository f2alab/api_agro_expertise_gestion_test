-- =============================================================================
-- GAE - ERP : 29_retours_ventes.sql
-- Retours de vente (client qui rapporte un ou plusieurs produits achetes).
--   * `pharmacie_ventes.montant_retourne` : cumul TTC des produits retournes ;
--   * `pharmacie_retours_ventes` + `_lignes` : trace de chaque retour ;
--   * `reste_a_payer` recalcule en tenant compte des retours (trigger paiements) ;
--   * vues financieres : chiffre d'affaires et marge NETS des retours ;
--   * permission `pharmacie.ventes.manage` (enregistrer un retour) ;
--   * temps reel sur les tables de retour.
-- A executer APRES 28_parametres.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Colonne cumul des retours sur la vente
-- -----------------------------------------------------------------------------
ALTER TABLE pharmacie_ventes
  ADD COLUMN IF NOT EXISTS montant_retourne NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN pharmacie_ventes.montant_retourne IS 'Cumul TTC des produits retournes par le client.';

-- -----------------------------------------------------------------------------
-- Table : pharmacie_retours_ventes (entete d'un retour)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacie_retours_ventes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            VARCHAR(40) NOT NULL UNIQUE,
  vente_id          UUID NOT NULL REFERENCES pharmacie_ventes(id) ON DELETE CASCADE,
  point_id          UUID NOT NULL REFERENCES pharmacie_points(id) ON DELETE RESTRICT,
  client_id         UUID REFERENCES pharmacie_clients(id) ON DELETE SET NULL,
  montant_ttc       NUMERIC(14,2) NOT NULL DEFAULT 0,
  montant_rembourse NUMERIC(14,2) NOT NULL DEFAULT 0,
  motif             TEXT,
  effectue_par      UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_retour       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pharmacie_retours_ventes IS 'Retours de produits sur une vente (entete).';

CREATE INDEX IF NOT EXISTS idx_pharmacie_retours_ventes_vente ON pharmacie_retours_ventes(vente_id);
CREATE INDEX IF NOT EXISTS idx_pharmacie_retours_ventes_date  ON pharmacie_retours_ventes(date_retour DESC);

-- -----------------------------------------------------------------------------
-- Table : pharmacie_retours_ventes_lignes (detail d'un retour)
-- total_ligne est conserve en HT (comme les lignes de vente).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacie_retours_ventes_lignes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retour_id      UUID NOT NULL REFERENCES pharmacie_retours_ventes(id) ON DELETE CASCADE,
  vente_ligne_id UUID REFERENCES pharmacie_ventes_lignes(id) ON DELETE SET NULL,
  produit_id     UUID NOT NULL REFERENCES pharmacie_produits(id) ON DELETE RESTRICT,
  quantite       INTEGER NOT NULL DEFAULT 1,
  prix_unitaire  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cout_unitaire  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ligne    NUMERIC(14,2) NOT NULL DEFAULT 0
);

COMMENT ON TABLE pharmacie_retours_ventes_lignes IS 'Lignes d''un retour de vente (produit, quantite, valeur HT).';

CREATE INDEX IF NOT EXISTS idx_pharmacie_retours_ventes_lignes_retour
  ON pharmacie_retours_ventes_lignes(retour_id);

-- -----------------------------------------------------------------------------
-- Synchronisation : tout encaissement recalcule le reste du en tenant compte
-- des retours deja enregistres (total_ttc - retours - paiements).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pharmacie_vente_maj_paiements() RETURNS TRIGGER AS $$
DECLARE
  v_vente UUID;
  v_somme NUMERIC(14,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_vente := OLD.vente_id;
  ELSE
    v_vente := NEW.vente_id;
  END IF;

  SELECT COALESCE(SUM(montant), 0) INTO v_somme
  FROM pharmacie_paiements WHERE vente_id = v_vente;

  UPDATE pharmacie_ventes
  SET total_paye = v_somme,
      reste_a_payer = GREATEST(total_ttc - COALESCE(montant_retourne, 0) - v_somme, 0)
  WHERE id = v_vente;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Reprise : les ventes deja soldees gardent leur reste a 0.
-- -----------------------------------------------------------------------------
UPDATE pharmacie_ventes
SET reste_a_payer = GREATEST(total_ttc - COALESCE(montant_retourne, 0) - COALESCE(total_paye, 0), 0);

-- -----------------------------------------------------------------------------
-- Vue : ventes journalieres, chiffre d'affaires et marge NETS des retours.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_ventes_journalieres AS
SELECT
  v.point_id,
  po.nom                       AS point_nom,
  date_trunc('day', v.date_vente)::DATE AS jour,
  count(*)::INTEGER            AS nb_ventes,
  SUM(v.total_ttc - COALESCE(v.montant_retourne, 0))                              AS chiffre_affaires,
  SUM(v.cout_total - COALESCE(r.cout_retour, 0))                                  AS cout_total,
  SUM(v.marge - (COALESCE(r.montant_ht_retour, 0) - COALESCE(r.cout_retour, 0)))  AS marge
FROM pharmacie_ventes v
JOIN pharmacie_points po ON po.id = v.point_id
LEFT JOIN (
  SELECT rv.vente_id,
         SUM(rl.total_ligne)                 AS montant_ht_retour,
         SUM(rl.cout_unitaire * rl.quantite) AS cout_retour
  FROM pharmacie_retours_ventes rv
  JOIN pharmacie_retours_ventes_lignes rl ON rl.retour_id = rv.id
  GROUP BY rv.vente_id
) r ON r.vente_id = v.id
WHERE v.statut = 'VALIDEE'
GROUP BY v.point_id, po.nom, date_trunc('day', v.date_vente)::DATE;

COMMENT ON VIEW v_pharmacie_ventes_journalieres IS 'Chiffre d''affaires et marge (nets des retours) par jour et par point.';

-- -----------------------------------------------------------------------------
-- Vue : synthese financiere par point de vente (nettes des retours).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_pharmacie_ca_par_point AS
SELECT
  po.id   AS point_id,
  po.code AS point_code,
  po.nom  AS point_nom,
  COALESCE(v.nb_ventes, 0)           AS nb_ventes,
  COALESCE(v.chiffre_affaires, 0)    AS chiffre_affaires,
  COALESCE(v.marge, 0)               AS marge,
  COALESCE(v.cout_total, 0)          AS cout_ventes,
  COALESCE(st.valeur_stock, 0)       AS valeur_stock_achat,
  COALESCE(st.valeur_stock_vente, 0) AS valeur_stock_vente,
  COALESCE(pmt.encaisse, 0)          AS encaisse
FROM pharmacie_points po
LEFT JOIN (
  SELECT v.point_id,
         count(*)::INTEGER AS nb_ventes,
         SUM(v.total_ttc - COALESCE(v.montant_retourne, 0)) AS chiffre_affaires,
         SUM(v.marge - (COALESCE(r.montant_ht_retour, 0) - COALESCE(r.cout_retour, 0))) AS marge,
         SUM(v.cout_total - COALESCE(r.cout_retour, 0)) AS cout_total
  FROM pharmacie_ventes v
  LEFT JOIN (
    SELECT rv.vente_id,
           SUM(rl.total_ligne)                 AS montant_ht_retour,
           SUM(rl.cout_unitaire * rl.quantite) AS cout_retour
    FROM pharmacie_retours_ventes rv
    JOIN pharmacie_retours_ventes_lignes rl ON rl.retour_id = rv.id
    GROUP BY rv.vente_id
  ) r ON r.vente_id = v.id
  WHERE v.statut = 'VALIDEE'
  GROUP BY v.point_id
) v ON v.point_id = po.id
LEFT JOIN (
  SELECT point_id,
         SUM(valeur_achat) AS valeur_stock,
         SUM(valeur_vente) AS valeur_stock_vente
  FROM v_pharmacie_stock_valorise GROUP BY point_id
) st ON st.point_id = po.id
LEFT JOIN (
  SELECT v.point_id, SUM(p.montant) AS encaisse
  FROM pharmacie_paiements p
  JOIN pharmacie_ventes v ON v.id = p.vente_id
  WHERE v.statut = 'VALIDEE'
  GROUP BY v.point_id
) pmt ON pmt.point_id = po.id;

COMMENT ON VIEW v_pharmacie_ca_par_point IS 'Synthese financiere (nette des retours): CA, marge, valeur stock et encaissements par point.';

-- -----------------------------------------------------------------------------
-- Permission : enregistrer un retour de vente.
-- L'action « manage » est utilisee car la contrainte ck_permissions_action
-- n'autorise pas d'action personnalisee ; le motif « pharmacie.ventes.% »
-- couvre les profils de vente (PPV, RESP_COMMERCIAL) et « pharmacie.% » les
-- responsables de pharmacie et la direction technique.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('pharmacie.ventes.manage', 'pharmacie', 'ventes', 'manage', 'Enregistrer un retour de vente', 'Retourner des produits d''une vente et remettre le stock')
ON CONFLICT (code) DO NOTHING;

WITH attributions (role_code, motifs) AS (VALUES
  ('SUPER_ADMIN',     ARRAY['%']),
  ('RESP_PHARMACIE',  ARRAY['pharmacie.%']),
  ('DIR_TECHNIQUE',   ARRAY['pharmacie.%']),
  ('RESP_COMMERCIAL', ARRAY['pharmacie.ventes.%']),
  ('PPV',             ARRAY['pharmacie.ventes.%'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON EXISTS (
  SELECT 1 FROM unnest(a.motifs) AS m(motif) WHERE p.code LIKE m.motif
)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Temps réel : les retours rafraichissent les ecrans des ventes.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  association RECORD;
  nom_trigger TEXT;
BEGIN
  IF to_regprocedure('fn_notifier_temps_reel()') IS NULL THEN
    RETURN;
  END IF;

  FOR association IN
    SELECT * FROM (VALUES
      ('pharmacie_retours_ventes',        'pharmacie.ventes'),
      ('pharmacie_retours_ventes_lignes', 'pharmacie.ventes')
    ) AS t(table_cible, type_evenement)
  LOOP
    IF to_regclass(association.table_cible) IS NULL THEN
      CONTINUE;
    END IF;

    nom_trigger := 'trg_temps_reel_' || left(association.table_cible, 45);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', nom_trigger, association.table_cible);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel(%L)',
      nom_trigger, association.table_cible, association.type_evenement
    );
  END LOOP;
END $$;