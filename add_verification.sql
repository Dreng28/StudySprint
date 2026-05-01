-- ═══════════════════════════════════════════════════════════════
-- StudySprint — Add Email Verification to users table
-- Run ONCE on your existing database:
--   mysql -u root -p studysprint_db < add_verification.sql
-- ═══════════════════════════════════════════════════════════════

USE studysprint_db;

ALTER TABLE users
  ADD COLUMN is_verified        TINYINT(1)   DEFAULT 0          AFTER notif_weekly,
  ADD COLUMN verify_token       VARCHAR(255) DEFAULT NULL       AFTER is_verified,
  ADD COLUMN verify_token_exp   DATETIME     DEFAULT NULL       AFTER verify_token,
  ADD COLUMN terms_accepted     TINYINT(1)   DEFAULT 0          AFTER verify_token_exp,
  ADD COLUMN terms_accepted_at  DATETIME     DEFAULT NULL       AFTER terms_accepted;
