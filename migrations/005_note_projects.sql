-- Tag notes with projects (shown in the app as "areas"). A note can carry
-- several; deleting a note or a project removes its tags.
-- Additive only. Apply BEFORE deploying the code that reads note_projects.
-- Run with: psql "$DATABASE_URL" -f migrations/005_note_projects.sql

CREATE TABLE IF NOT EXISTS note_projects (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, project_id)
);

CREATE INDEX IF NOT EXISTS note_projects_user_project_idx ON note_projects (user_id, project_id);
