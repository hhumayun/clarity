-- Focus time sessions, and a mark on notes saved during focus.
-- Additive only: code from before this migration keeps working against it,
-- so apply it BEFORE deploying the code that reads notes.source.
-- Run with: psql "$DATABASE_URL" -f migrations/004_focus_and_note_source.sql

-- Where a note came from. NULL is an ordinary note written in the editor;
-- 'focus' is a thought parked during focus time.
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS source TEXT
  CONSTRAINT notes_source_check CHECK (source IN ('focus'));

CREATE TABLE IF NOT EXISTS focus_sessions (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  planned_minutes  INTEGER NOT NULL CHECK (planned_minutes BETWEEN 1 AND 180),
  focused_seconds  INTEGER NOT NULL CHECK (focused_seconds BETWEEN 0 AND 43200),
  first_step       TEXT NOT NULL DEFAULT '',
  outcome          TEXT NOT NULL CHECK (outcome IN ('finished', 'progress', 'stuck')),
  left_off         TEXT NOT NULL DEFAULT '',
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS focus_sessions_user_task_idx ON focus_sessions (user_id, task_id);
CREATE INDEX IF NOT EXISTS focus_sessions_user_ended_idx ON focus_sessions (user_id, ended_at);
