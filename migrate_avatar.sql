-- Run this migration to add avatar support to the user table.
-- Safe to run multiple times (uses IF NOT EXISTS pattern via separate statements).

USE call_app;

ALTER TABLE user
  ADD COLUMN IF NOT EXISTS avatar_url      VARCHAR(512) NULL AFTER Password_hash,
  ADD COLUMN IF NOT EXISTS avatar_color    VARCHAR(120) NULL AFTER avatar_url,
  ADD COLUMN IF NOT EXISTS avatar_initials VARCHAR(4)   NULL AFTER avatar_color;
