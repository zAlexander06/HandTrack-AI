-- ================================================================
-- HandTrackLIS — Schema MySQL (phpMyAdmin)
-- Convertito da PostgreSQL/Supabase
-- ================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- ----------------------------------------------------------------
-- TABELLA: users
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `realName`      VARCHAR(32) NOT NULL,
  `surname`       VARCHAR(32) NOT NULL,
  `username`      VARCHAR(32) NOT NULL,
  `email`         VARCHAR(320) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role_user`     ENUM('utente','admin','moderator','onThinIce') NOT NULL DEFAULT 'utente',
  `status_user`   ENUM('online','offline') NOT NULL DEFAULT 'offline',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_realname` (`realName`),
  UNIQUE KEY `uq_surname`  (`surname`),
  UNIQUE KEY `uq_username` (`username`),
  UNIQUE KEY `uq_email`    (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: contact
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contact` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `contact_id`     BIGINT UNSIGNED NOT NULL,
  `status_contact` ENUM('pending','accepted','blocked','special') NOT NULL DEFAULT 'pending',
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contact_pair` (`user_id`,`contact_id`),
  KEY `idx_contact_user_id`    (`user_id`),
  KEY `idx_contact_contact_id` (`contact_id`),
  CONSTRAINT `chk_contact_no_self` CHECK (`user_id` <> `contact_id`),
  CONSTRAINT `fk_contact_user`    FOREIGN KEY (`user_id`)    REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contact_contact` FOREIGN KEY (`contact_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: call_table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `call_table` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `caller_id`   BIGINT UNSIGNED NOT NULL,
  `receiver_id` BIGINT UNSIGNED DEFAULT NULL,
  `call_type`   ENUM('direct','group') NOT NULL DEFAULT 'direct',
  `status_call` ENUM('ringing','accepted','missed','ended') NOT NULL DEFAULT 'ringing',
  `start_time`  DATETIME DEFAULT NULL,
  `end_time`    DATETIME DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_call_caller_id`   (`caller_id`),
  KEY `idx_call_receiver_id` (`receiver_id`),
  CONSTRAINT `fk_call_caller`   FOREIGN KEY (`caller_id`)   REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_call_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: call_participants
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `call_participants` (
  `id`        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `call_id`   BIGINT UNSIGNED NOT NULL,
  `user_id`   BIGINT UNSIGNED NOT NULL,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at`   DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_call_participant` (`call_id`,`user_id`),
  CONSTRAINT `fk_participant_call` FOREIGN KEY (`call_id`) REFERENCES `call_table`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_participant_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: message
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `message` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sender_id`   BIGINT UNSIGNED NOT NULL,
  `receiver_id` BIGINT UNSIGNED DEFAULT NULL,
  `call_id`     BIGINT UNSIGNED DEFAULT NULL,
  `content`     TEXT NOT NULL,
  `sent_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_message_sender_id`   (`sender_id`),
  KEY `idx_message_receiver_id` (`receiver_id`),
  KEY `idx_message_call_id`     (`call_id`),
  CONSTRAINT `fk_message_sender`   FOREIGN KEY (`sender_id`)   REFERENCES `users`(`id`)      ON DELETE CASCADE,
  CONSTRAINT `fk_message_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`)      ON DELETE CASCADE,
  CONSTRAINT `fk_message_call`     FOREIGN KEY (`call_id`)     REFERENCES `call_table`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: notification
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notification` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           BIGINT UNSIGNED NOT NULL,
  `type_notification` VARCHAR(50) DEFAULT NULL,
  `content`           TEXT,
  `is_read`           TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notification_user_id` (`user_id`),
  CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: report
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `report` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reporter_id`   BIGINT UNSIGNED NOT NULL,
  `reported_id`   BIGINT UNSIGNED NOT NULL,
  `reason`        TEXT,
  `status_report` ENUM('pending','reviewed','resolved') NOT NULL DEFAULT 'pending',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_report_no_self`  CHECK (`reporter_id` <> `reported_id`),
  CONSTRAINT `fk_report_reporter`  FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_report_reported`  FOREIGN KEY (`reported_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: moderation_action
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `moderation_action` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`           BIGINT UNSIGNED NOT NULL,
  `target_user_id`     BIGINT UNSIGNED DEFAULT NULL,
  `action_type`        VARCHAR(50) DEFAULT NULL,
  `description_action` TEXT,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_moderation_admin`  FOREIGN KEY (`admin_id`)       REFERENCES `users`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_moderation_target` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------
-- TABELLA: banned_word
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `banned_word` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `word`       VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_word` (`word`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


ALTER TABLE users ADD COLUMN last_seen DATETIME DEFAULT NULL;


-- ================================================================
-- HandTrackLIS — Migration: eliminazione account schedulata
-- Esegui questo script UNA SOLA VOLTA in phpMyAdmin (o CLI).
-- ================================================================

-- 1. Aggiungi la colonna alla tabella users
ALTER TABLE `users`
  ADD COLUMN `scheduled_deletion_at` DATETIME DEFAULT NULL
    COMMENT 'Se valorizzata, l''account verrà eliminato alla data indicata (dopo 7 gg dalla richiesta).'
  AFTER `created_at`;

-- 2. View opzionale: utenti da eliminare (utile per monitoraggio e cron)
CREATE OR REPLACE VIEW `v_accounts_pending_deletion` AS
  SELECT
    id,
    realName,
    surname,
    username,
    email,
    scheduled_deletion_at,
    TIMESTAMPDIFF(HOUR, NOW(), scheduled_deletion_at) AS hours_remaining
  FROM `users`
  WHERE `scheduled_deletion_at` IS NOT NULL
    AND `scheduled_deletion_at` <= NOW() + INTERVAL 7 DAY;