-- =============================================================================
-- GAE - ERP : 23_referentiels_codes_rayon_3_chiffres.sql
-- Uniformise les codes RAYON sur 3 chiffres (RAY0001 -> RAY001) et met a jour
-- les produits qui les referencent. Idempotent.
-- A executer APRES 22_referentiels_suppression_ordre.sql.
-- =============================================================================

SET client_encoding = 'UTF8';

DO $$
DECLARE
  r RECORD;
  nouveau TEXT;
BEGIN
  FOR r IN
    SELECT id, code
    FROM pharmacie_referentiels
    WHERE type = 'RAYON' AND code ~ '^RAY[0-9]{4}$'
    ORDER BY code DESC
  LOOP
    nouveau := 'RAY' || lpad((substring(r.code from '[0-9]+$'))::int::text, 3, '0');

    -- Renomme seulement s'il n'y a pas deja un code identique (pas de collision).
    IF nouveau <> r.code
       AND NOT EXISTS (
         SELECT 1 FROM pharmacie_referentiels WHERE type = 'RAYON' AND code = nouveau
       ) THEN
      UPDATE pharmacie_produits SET rayon = nouveau WHERE rayon = r.code;
      UPDATE pharmacie_referentiels SET code = nouveau WHERE id = r.id;
    END IF;
  END LOOP;
END $$;