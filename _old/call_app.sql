CREATE DATABASE IF NOT EXISTS call_app;
USE call_app;

-- Eliminazione tabelle esistenti (ordine inverso per rispettare i FK)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `banned_word`;
DROP TABLE IF EXISTS `moderation_action`;
DROP TABLE IF EXISTS `report`;
DROP TABLE IF EXISTS `notification`;
DROP TABLE IF EXISTS `message`;
DROP TABLE IF EXISTS `call_participants`;
DROP TABLE IF EXISTS `calls`;
DROP TABLE IF EXISTS `contact`;
DROP TABLE IF EXISTS `user`;
SET FOREIGN_KEY_CHECKS = 1;


-- UTENTI
CREATE TABLE `user` (
  Id             INT AUTO_INCREMENT PRIMARY KEY,
  Username       VARCHAR(32)  UNIQUE NOT NULL,
  Email          VARCHAR(320) UNIQUE NOT NULL,
  Password_hash  VARCHAR(255) NOT NULL,
  Role_user      ENUM('user','admin','moderator', 'onThinIce') DEFAULT 'user',
  Status_user    ENUM('online','offline')         DEFAULT 'offline',
  Created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- CONTATTI
CREATE TABLE `contact` (
  Id              INT AUTO_INCREMENT PRIMARY KEY,
  User_id         INT NOT NULL,
  Contact_id      INT NOT NULL,
  Status_contact  ENUM('pending','accepted','blocked', 'special') DEFAULT 'pending',
  Created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_contact_no_self CHECK (User_id <> Contact_id),
  CONSTRAINT uq_contact_pair UNIQUE (User_id, Contact_id),

  FOREIGN KEY (User_id)    REFERENCES `user`(Id) ON DELETE CASCADE,
  FOREIGN KEY (Contact_id) REFERENCES `user`(Id) ON DELETE CASCADE
);


-- CHIAMATE
CREATE TABLE `calls` (
  Id          INT AUTO_INCREMENT PRIMARY KEY,
  Caller_id   INT NOT NULL,
  Receiver_id INT NULL,
  Call_type   ENUM('direct','group') DEFAULT 'direct',
  Status_call ENUM('ringing','accepted','missed','ended') DEFAULT 'ringing',
  Start_time  TIMESTAMP    NULL,
  End_time    TIMESTAMP    NULL,
  Created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_call_times CHECK (End_time IS NULL OR End_time >= Start_time),

  FOREIGN KEY (Caller_id)   REFERENCES `user`(Id) ON DELETE CASCADE,
  FOREIGN KEY (Receiver_id) REFERENCES `user`(Id) ON DELETE SET NULL
);


-- PARTECIPANTI CHIAMATA GRUPPO
CREATE TABLE `call_participants` (
  Id        INT AUTO_INCREMENT PRIMARY KEY,
  Call_id   INT NOT NULL,
  User_id   INT NOT NULL,
  Joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  Left_at   TIMESTAMP NULL,

  CONSTRAINT uq_call_participant UNIQUE (Call_id, User_id),
  CONSTRAINT chk_left_after_join CHECK (Left_at IS NULL OR Left_at >= Joined_at),

  FOREIGN KEY (Call_id) REFERENCES `calls`(Id) ON DELETE CASCADE,
  FOREIGN KEY (User_id) REFERENCES `user`(Id) ON DELETE CASCADE
);


-- MESSAGGI CHIAMATA
CREATE TABLE `message` (
  Id           INT AUTO_INCREMENT PRIMARY KEY,
  Sender_id    INT NOT NULL,
  Receiver_id  INT  NULL,
  Call_id      INT  NULL,
  Content      TEXT NOT NULL,
  Sent_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_message_target CHECK (Receiver_id IS NOT NULL OR Call_id IS NOT NULL),

  FOREIGN KEY (Sender_id)   REFERENCES `user`(Id) ON DELETE CASCADE,
  FOREIGN KEY (Receiver_id) REFERENCES `user`(Id) ON DELETE CASCADE,
  FOREIGN KEY (Call_id)     REFERENCES `calls`(Id) ON DELETE CASCADE
);


-- NOTIFICHE
CREATE TABLE `notification` (
  Id                INT AUTO_INCREMENT PRIMARY KEY,
  User_id           INT NOT NULL,
  Type_notification VARCHAR(50),
  Content           TEXT,
  Is_read           BOOLEAN   DEFAULT FALSE,
  Created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (User_id) REFERENCES `user`(Id) ON DELETE CASCADE
);


-- SEGNALAZIONI
CREATE TABLE `report` (
  Id            INT AUTO_INCREMENT PRIMARY KEY,
  Reporter_id   INT NOT NULL,
  Reported_id   INT NOT NULL,
  Reason        TEXT,
  Status_report ENUM('pending','reviewed','resolved') DEFAULT 'pending',
  Created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_report_no_self CHECK (Reporter_id <> Reported_id),

  FOREIGN KEY (Reporter_id) REFERENCES `user`(Id) ON DELETE CASCADE,
  FOREIGN KEY (Reported_id) REFERENCES `user`(Id) ON DELETE CASCADE
);


-- AZIONI ADMIN
CREATE TABLE `moderation_action` (
  Id                 INT AUTO_INCREMENT PRIMARY KEY,
  Admin_id           INT NOT NULL,
  Target_user_id     INT NULL,
  Action_type        VARCHAR(50),
  Description_action TEXT,
  Created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (Admin_id)       REFERENCES `user`(Id) ON DELETE RESTRICT,
  FOREIGN KEY (Target_user_id) REFERENCES `user`(Id) ON DELETE SET NULL
);


-- PAROLE BANNATE
CREATE TABLE `banned_word` (
  Id         INT AUTO_INCREMENT PRIMARY KEY,
  Word       VARCHAR(100) UNIQUE NOT NULL,
  Created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);