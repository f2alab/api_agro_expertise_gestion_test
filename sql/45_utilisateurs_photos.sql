-- =============================================================================
-- GAE - ERP : 45_utilisateurs_photos.sql
-- Photos de profil des utilisateurs, stockees DANS la base de donnees.
--
-- Principe : la photo est un contenu binaire (BYTEA) range dans la table
-- `utilisateurs_photos`, une ligne par compte. Aucun systeme de stockage
-- externe (disque partage, S3, CDN) n'est necessaire : la sauvegarde et la
-- restauration de la base suffisent a proteger les photos.
--
-- Choix de conception :
--   * cle primaire = utilisateur_id : une seule photo par compte, la mise a
--     jour est un simple INSERT ... ON CONFLICT DO UPDATE (upsert) ;
--   * ON DELETE CASCADE : archiver/supprimer un compte retire sa photo ;
--   * `empreinte` (SHA-256) sert d'ETag HTTP : le navigateur ne retelecharge
--     pas une photo inchangee (reponse 304) ;
--   * `taille_octets <= 1 Mo` : garde-fou en base, en plus de la limite
--     appliquee par l'API (512 Ko) et de la compression faite par le
--     navigateur (limite haute volontairement plus large que l'API) ;
--   * aucun index supplementaire : la cle primaire suffit (une recherche par
--     utilisateur, jamais de parcours de toutes les photos).
--
-- A executer APRES 44_finance_apports_comptes.sql (script idempotent).
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Table : utilisateurs_photos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS utilisateurs_photos (
  utilisateur_id UUID        PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
  contenu        BYTEA       NOT NULL,                 -- octets de l'image
  type_mime      VARCHAR(60) NOT NULL,                 -- image/jpeg, image/png...
  taille_octets  INTEGER     NOT NULL,                 -- longueur de `contenu`
  largeur        SMALLINT,                             -- dimensions (indicatives)
  hauteur        SMALLINT,
  empreinte      VARCHAR(64) NOT NULL,                 -- SHA-256 hexa (ETag)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_utilisateurs_photos_type CHECK (
    type_mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  ),
  CONSTRAINT ck_utilisateurs_photos_taille CHECK (
    taille_octets > 0 AND taille_octets <= 1048576
  )
);

COMMENT ON TABLE  utilisateurs_photos IS 'Photos de profil des comptes, stockees en base (BYTEA) : aucun stockage externe.';
COMMENT ON COLUMN utilisateurs_photos.contenu   IS 'Octets binaires de l''image (lue et renvoyee avec le bon Content-Type par l''API).';
COMMENT ON COLUMN utilisateurs_photos.empreinte IS 'Empreinte SHA-256 de l''image, utilisee comme ETag HTTP (mise en cache navigateur).';

-- -----------------------------------------------------------------------------
-- Trigger : mise a jour automatique de updated_at (fonction de 01_schema.sql)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_utilisateurs_photos_maj ON utilisateurs_photos;
CREATE TRIGGER trg_utilisateurs_photos_maj BEFORE UPDATE ON utilisateurs_photos
  FOR EACH ROW EXECUTE FUNCTION fn_maj_horodatage();

-- -----------------------------------------------------------------------------
-- Temps reel : un changement de photo rafraichit avatars et listes abonnees.
-- Le type `iam.utilisateurs` est deja declare dans src/realtime/evenements.js
-- (permission requise : iam.users.read) ; les utilisateurs non habilites ne
-- recoivent donc pas l'evenement.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('fn_notifier_temps_reel()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_temps_reel_utilisateurs_photos ON utilisateurs_photos;
    CREATE TRIGGER trg_temps_reel_utilisateurs_photos
      AFTER INSERT OR UPDATE OR DELETE ON utilisateurs_photos
      FOR EACH ROW EXECUTE FUNCTION fn_notifier_temps_reel('iam.utilisateurs');
  END IF;
END $$;
