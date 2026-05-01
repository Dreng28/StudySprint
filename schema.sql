-- ═══════════════════════════════════════════════════════════════
-- StudySprint Database Schema
-- MySQL 8.0+
-- Run this file once to create all tables:
--   mysql -u root -p < db/schema.sql
-- ═══════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS studysprint_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE studysprint_db;

-- ─────────────────────────────────────────
-- 1. USERS
-- Stores all student accounts
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  student_id    VARCHAR(50)   DEFAULT NULL,
  program       VARCHAR(100)  DEFAULT NULL,
  sprint_duration INT UNSIGNED DEFAULT 45,   -- minutes
  study_mode    ENUM('intensive','balanced','relaxed') DEFAULT 'balanced',
  notif_email   TINYINT(1)    DEFAULT 1,
  notif_sprint  TINYINT(1)    DEFAULT 1,
  notif_deadline TINYINT(1)   DEFAULT 1,
  notif_weekly  TINYINT(1)    DEFAULT 0,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────
-- 2. COURSES
-- One course per syllabus upload
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED  NOT NULL,
  course_name   VARCHAR(150)  NOT NULL,
  course_code   VARCHAR(30)   DEFAULT NULL,
  instructor    VARCHAR(100)  DEFAULT NULL,
  semester      VARCHAR(80)   DEFAULT NULL,
  summary       TEXT          DEFAULT NULL,
  color         VARCHAR(7)    DEFAULT '#6C2BD9',  -- hex colour for UI
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────
-- 3. SYLLABI
-- Raw + parsed syllabus data per course
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS syllabi (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id     INT UNSIGNED  NOT NULL,
  user_id       INT UNSIGNED  NOT NULL,
  original_text LONGTEXT      DEFAULT NULL,  -- raw extracted text
  parsed_json   JSON          DEFAULT NULL,  -- full Claude API response
  file_name     VARCHAR(255)  DEFAULT NULL,
  file_size     INT UNSIGNED  DEFAULT NULL,  -- bytes
  parse_status  ENUM('pending','parsed','failed') DEFAULT 'pending',
  flags         JSON          DEFAULT NULL,  -- flagged items array
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
);

-- ─────────────────────────────────────────
-- 4. ASSESSMENTS
-- Individual graded items extracted from syllabus
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id     INT UNSIGNED  NOT NULL,
  user_id       INT UNSIGNED  NOT NULL,
  name          VARCHAR(150)  NOT NULL,
  type          ENUM('quiz','exam','project','lab','other') DEFAULT 'other',
  due_date      DATE          DEFAULT NULL,
  weight_percent DECIMAL(5,2) DEFAULT NULL,
  is_confirmed  TINYINT(1)    DEFAULT 0,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
);

-- ─────────────────────────────────────────
-- 5. SPRINTS
-- Individual study tasks in the schedule
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprints (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED  NOT NULL,
  course_id       INT UNSIGNED  NOT NULL,
  assessment_id   INT UNSIGNED  DEFAULT NULL,  -- optional link to assessment
  title           VARCHAR(200)  NOT NULL,
  duration_min    INT UNSIGNED  DEFAULT 45,
  priority        ENUM('high','medium','low') DEFAULT 'medium',
  scheduled_date  DATE          DEFAULT NULL,
  scheduled_slot  ENUM('morning','afternoon','evening') DEFAULT 'morning',
  linked_deadline DATE          DEFAULT NULL,
  ai_reason       TEXT          DEFAULT NULL,  -- why AI scheduled this
  is_done         TINYINT(1)    DEFAULT 0,
  done_at         TIMESTAMP     DEFAULT NULL,
  is_postponed    TINYINT(1)    DEFAULT 0,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
  FOREIGN KEY (course_id)     REFERENCES courses(id)     ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────
-- 6. ACTIVITY LOG
-- Recent activity feed on the dashboard
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED  NOT NULL,
  type        ENUM('sprint_done','syllabus_uploaded','deadline_alert','goal_achieved') NOT NULL,
  title       VARCHAR(150)  NOT NULL,
  subtitle    VARCHAR(150)  DEFAULT NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────
-- Useful indexes for performance
-- ─────────────────────────────────────────
CREATE INDEX idx_courses_user     ON courses(user_id);
CREATE INDEX idx_syllabi_course   ON syllabi(course_id);
CREATE INDEX idx_assessments_course ON assessments(course_id);
CREATE INDEX idx_sprints_user     ON sprints(user_id);
CREATE INDEX idx_sprints_date     ON sprints(scheduled_date);
CREATE INDEX idx_activity_user    ON activity_log(user_id);
