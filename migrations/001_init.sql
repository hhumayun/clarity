-- Clarity Notes — initial schema for Neon (PostgreSQL).
-- Run with: psql "$DATABASE_URL" -f migrations/001_init.sql
-- (or paste into the Neon SQL Editor)

-- Enums -----------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('admin', 'user');
CREATE TYPE entity_type AS ENUM ('activity', 'event', 'person', 'place', 'topic');
CREATE TYPE suggestion_action AS ENUM ('accepted', 'dismissed', 'edited', 'shown');
CREATE TYPE suggestion_source AS ENUM ('ai', 'history', 'offline', 'prompt');
CREATE TYPE task_status AS ENUM ('done', 'in_progress', 'todo');

-- Users (linked to Clerk via clerk_id) ----------------------------------------

CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  clerk_id     TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  role         user_role NOT NULL DEFAULT 'user',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  use_personalization BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notes -----------------------------------------------------------------------

CREATE TABLE notes (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  entities_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notes_user_id_idx ON notes (user_id);

CREATE TABLE note_entities (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  note_id         TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            entity_type NOT NULL,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX note_entities_user_id_idx ON note_entities (user_id);
CREATE INDEX note_entities_note_id_idx ON note_entities (note_id);

-- Projects & tasks --------------------------------------------------------------

CREATE TABLE projects (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_user_id_idx ON projects (user_id);

ALTER TABLE projects
  ADD CONSTRAINT projects_user_normalized_name_key UNIQUE (user_id, normalized_name);

CREATE TABLE tasks (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_id            TEXT REFERENCES notes(id) ON DELETE SET NULL,
  text               TEXT NOT NULL,
  status             task_status NOT NULL DEFAULT 'todo',
  complete_by        TIMESTAMPTZ,
  source_fingerprint TEXT,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tasks_user_id_idx ON tasks (user_id);
CREATE INDEX tasks_project_id_idx ON tasks (project_id);

ALTER TABLE tasks
  ADD CONSTRAINT tasks_user_note_fingerprint_key UNIQUE (user_id, note_id, source_fingerprint);

CREATE TABLE task_extractions (
  note_id      TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suggestion personalization ----------------------------------------------------

CREATE TABLE suggestion_events (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id         TEXT REFERENCES notes(id) ON DELETE SET NULL,
  suggestion_text TEXT NOT NULL,
  source          suggestion_source NOT NULL,
  action          suggestion_action NOT NULL,
  response_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX suggestion_events_user_id_idx ON suggestion_events (user_id);
