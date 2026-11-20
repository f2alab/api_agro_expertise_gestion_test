-- =============================================================================
-- GAE - ERP : 55_temps_reel_clinique.sql
-- Module Clinique : unification du temps reel (triggers un par domaine).
--
-- Pourquoi ce correctif : `49_clinique_permissions.sql` publiait un type unique
-- `clinique.consultation`, qui n'etait pas declare dans le catalogue
-- (`src/realtime/evenements.js`) : les evenements etaient donc REJETES par le
-- serveur SSE et aucun ecran du module ne se rafraichissait.
--
-- Chaque domaine publie desormais son propre type, ce qui permet a chaque ecran
-- de ne s'abonner qu'a ce qu'il affiche.
-- A executer APRES 54_permission_annulation_passage.sql (idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

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
      ('clinique_consultations',         'clinique.consultations'),
      ('clinique_examens',               'clinique.consultations'),
      ('clinique_examens_organes',       'clinique.consultations'),
      ('clinique_diagnostics',           'clinique.consultations'),
      ('clinique_animaux',               'clinique.animaux'),
      ('clinique_proprietaires',         'clinique.proprietaires'),
      ('clinique_examens_paracliniques', 'clinique.paracliniques'),
      ('clinique_ordonnances',           'clinique.ordonnances'),
      ('clinique_ordonnances_lignes',    'clinique.ordonnances'),
      ('clinique_factures',              'clinique.factures'),
      ('clinique_factures_lignes',       'clinique.factures')
    ) AS t(table_cible, type_evenement)
  LOOP
    IF to_regclass(association.table_cible) IS NULL THEN
      CONTINUE;
    END IF;

    -- Plusieurs declencheurs coexistent (noms distincts) : on nettoie d'abord
    -- ceux de 49 pour eviter deux notifications par modification.
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_temps_reel_' || association.table_cible, association.table_cible);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', association.table_cible, association.table_cible);

    nom_trigger := 'trg_temps_reel_' || left(association.table_cible, 45);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', nom_trigger, association.table_cible);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel(%L)',
      nom_trigger, association.table_cible, association.type_evenement
    );
  END LOOP;
END $$;