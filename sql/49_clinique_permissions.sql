-- =============================================================================
-- GAE - ERP : 49_clinique_permissions.sql
-- Module Clinique : permissions, rôles, paramètres et temps réel.
--   * permissions fines du parcours (accueil -> consultation -> paraclinique
--     -> ordonnance -> facture) ;
--   * permission dédiée `clinique.frais.update` : modification du tarif de
--     consultation réservée à la Direction (DG, DGA) et au Directeur Technique ;
--   * paramètre `clinique.consultation.frais` (montant par défaut : 5 000 F) ;
--   * triggers de temps réel : les écrans abonnés se rafraîchissent.
-- A executer APRES 48_clinique_vues_fonctions.sql (script idempotent, rejouable).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Permissions du module Clinique
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('clinique.proprietaires.read',    'clinique', 'proprietaires', 'read',     'Consulter les propriétaires',        'Accéder au fichier des propriétaires d''animaux'),
  ('clinique.proprietaires.create',  'clinique', 'proprietaires', 'create',   'Créer un propriétaire',              'Enregistrer un nouveau propriétaire'),
  ('clinique.proprietaires.update',  'clinique', 'proprietaires', 'update',   'Modifier un propriétaire',           'Mettre à jour une fiche propriétaire'),
  ('clinique.proprietaires.delete',  'clinique', 'proprietaires', 'delete',   'Désactiver un propriétaire',         'Archiver une fiche propriétaire'),
  ('clinique.animaux.delete',        'clinique', 'animaux',       'delete',   'Désactiver un animal',               'Archiver une fiche animal'),
  ('clinique.consultations.update',  'clinique', 'consultations', 'update',   'Modifier une consultation',          'Corriger une consultation non clôturée'),
  ('clinique.examens.read',          'clinique', 'examens',       'read',     'Consulter les examens cliniques',    'Accéder aux examens à distance et rapprochés'),
  ('clinique.examens.create',        'clinique', 'examens',       'create',   'Enregistrer un examen clinique',     'Saisir les constantes et l''examen organe par organe'),
  ('clinique.examens.update',        'clinique', 'examens',       'update',   'Modifier un examen clinique',        'Corriger un examen clinique en cours'),
  ('clinique.paracliniques.read',    'clinique', 'paracliniques', 'read',     'Consulter les examens paracliniques','Accéder aux demandes et résultats paracliniques'),
  ('clinique.paracliniques.create',  'clinique', 'paracliniques', 'create',   'Demander un examen paraclinique',    'Créer une demande (imagerie, radio, écho, laboratoire)'),
  ('clinique.paracliniques.update',  'clinique', 'paracliniques', 'update',   'Saisir un résultat paraclinique',    'Renseigner le résultat d''un examen paraclinique'),
  ('clinique.paracliniques.validate','clinique', 'paracliniques', 'validate', 'Valider un résultat paraclinique',   'Valider et publier un résultat paraclinique'),
  ('clinique.ordonnances.read',      'clinique', 'ordonnances',   'read',     'Consulter les ordonnances',          'Accéder aux ordonnances de la clinique'),
  ('clinique.ordonnances.create',    'clinique', 'ordonnances',   'create',   'Créer une ordonnance',               'Prescrire des produits de la pharmacie'),
  ('clinique.ordonnances.update',    'clinique', 'ordonnances',   'update',   'Modifier une ordonnance',            'Modifier une ordonnance non servie'),
  ('clinique.ordonnances.validate',  'clinique', 'ordonnances',   'validate', 'Servir une ordonnance',              'Marquer une ordonnance comme servie en pharmacie'),
  ('clinique.factures.read',         'clinique', 'factures',      'read',     'Consulter les factures',             'Accéder aux factures de la clinique'),
  ('clinique.factures.create',       'clinique', 'factures',      'create',   'Générer une facture',                'Établir une facture globale de passage'),
  ('clinique.factures.update',       'clinique', 'factures',      'update',   'Modifier une facture',               'Corriger une facture non réglée'),
  ('clinique.factures.validate',     'clinique', 'factures',      'validate', 'Encaisser une facture',              'Enregistrer le règlement d''une facture'),
  ('clinique.factures.export',       'clinique', 'factures',      'export',   'Exporter les factures',              'Imprimer ou exporter les factures'),
  ('clinique.rapports.read',         'clinique', 'rapports',      'read',     'Consulter les rapports clinique',    'Accéder aux indicateurs d''activité de la clinique'),
  ('clinique.frais.update',          'clinique', 'frais',         'update',   'Modifier le tarif de consultation',  'Modifier les frais de consultation de la clinique')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, module, ressource, action, nom, description) VALUES
  ('clinique.referentiels.read',   'clinique', 'referentiels', 'read',   'Consulter les référentiels clinique', 'Espèces, races, motifs, organes et examens paracliniques'),
  ('clinique.referentiels.create', 'clinique', 'referentiels', 'create', 'Créer une entrée de référentiel',     'Ajouter une espèce, une race, un motif ou un organe'),
  ('clinique.referentiels.update', 'clinique', 'referentiels', 'update', 'Modifier une entrée de référentiel',  'Renommer ou désactiver une entrée de référentiel')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Attribution des nouvelles permissions aux rôles.
-- `clinique.frais.update` n'est volontairement PAS accordée au responsable
-- clinique : seule la Direction (DG, DGA), le Directeur Technique et le super
-- administrateur peuvent réviser le tarif de consultation.
-- -----------------------------------------------------------------------------
WITH attributions (role_code, motifs) AS (VALUES
  ('SUPER_ADMIN',       ARRAY['clinique.%']),
  ('DG',                ARRAY['clinique.%.read', 'clinique.frais.update', 'clinique.factures.export']),
  ('DGA',               ARRAY['clinique.%.read', 'clinique.frais.update', 'clinique.factures.export']),
  ('DIR_TECHNIQUE',     ARRAY['clinique.%']),
  ('RESP_CLINIQUE',     ARRAY['clinique.%']),
  ('RESP_PARACLINIQUE', ARRAY['clinique.paracliniques.%', 'clinique.consultations.read',
                              'clinique.examens.read', 'clinique.animaux.read',
                              'clinique.proprietaires.read', 'clinique.ordonnances.read']),
  ('RESP_PHARMACIE',    ARRAY['clinique.ordonnances.read', 'clinique.ordonnances.validate',
                              'clinique.animaux.read', 'clinique.factures.read']),
  ('RESP_ZOO',          ARRAY['clinique.animaux.%', 'clinique.proprietaires.%',
                              'clinique.consultations.read', 'clinique.examens.read',
                              'clinique.ordonnances.read']),
  ('COMPTABLE',         ARRAY['clinique.factures.read', 'clinique.factures.export',
                              'clinique.consultations.read', 'clinique.rapports.read']),
  ('TRESORIER',         ARRAY['clinique.factures.read', 'clinique.factures.validate',
                              'clinique.consultations.read']),
  ('TECHNICIEN',        ARRAY['clinique.proprietaires.%', 'clinique.animaux.%',
                              'clinique.consultations.%', 'clinique.examens.%',
                              'clinique.paracliniques.%', 'clinique.ordonnances.%',
                              'clinique.factures.%']),
  ('STAGIAIRE',         ARRAY['clinique.proprietaires.read', 'clinique.animaux.read',
                              'clinique.consultations.read', 'clinique.examens.read',
                              'clinique.ordonnances.read']),
  ('AUDITEUR',          ARRAY['clinique.%.read'])
)
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM attributions a
JOIN roles r       ON r.code = a.role_code
JOIN permissions p ON p.module = 'clinique'
WHERE EXISTS (SELECT 1 FROM unnest(a.motifs) AS m(motif) WHERE p.code LIKE m.motif)
  -- Exception : le responsable clinique ne récoit pas la modification du tarif.
  AND NOT (a.role_code = 'RESP_CLINIQUE' AND p.code = 'clinique.frais.update')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Paramètre : frais de consultation de la clinique (5 000 F par défaut).
-- Type NOMBRE : la page Paramètres l'affiche comme un champ modifiable. Seule
-- la permission `clinique.frais.update` (DG, DGA, Directeur Technique) autorise
-- sa révision, contrôle appliqué dans le contrôleur des paramètres.
-- -----------------------------------------------------------------------------
INSERT INTO parametres (cle, valeur, categorie, libelle, description, type_valeur, public) VALUES
  ('clinique.consultation.frais', '5000'::jsonb, 'clinique', 'Frais de consultation',
   'Montant facturé au propriétaire à l''enregistrement à l''accueil de la clinique (F CFA).',
   'NOMBRE', TRUE)
ON CONFLICT (cle) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Temps réel : chaque changement notifie les écrans abonnés du module clinique.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'clinique_proprietaires', 'clinique_animaux', 'clinique_consultations',
    'clinique_examens', 'clinique_examens_organes', 'clinique_diagnostics',
    'clinique_examens_paracliniques', 'clinique_ordonnances',
    'clinique_ordonnances_lignes', 'clinique_factures'
  ];
BEGIN
  IF to_regprocedure('fn_notifier_temps_reel()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(v_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_temps_reel_%s ON %I', v_table, v_table);
      EXECUTE format(
        'CREATE TRIGGER trg_temps_reel_%s AFTER INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel(%L)',
        v_table, v_table, 'clinique.consultation');
    END IF;
  END LOOP;
END $$;

-- Le tarif de consultation est un paramètre (clé `clinique.consultation.frais`) :
-- voir 28_parametres.sql et src/modules/parametres/parametres.controller.js pour
-- le contrôle d'accès (permission `clinique.frais.update`).


