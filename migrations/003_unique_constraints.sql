-- Unique constraints backing the ON CONFLICT clauses used by the
-- projects and task-extraction endpoints (idempotent upserts).
-- Run with: psql "$DATABASE_URL" -f migrations/003_unique_constraints.sql

ALTER TABLE projects
  ADD CONSTRAINT projects_user_normalized_name_key UNIQUE (user_id, normalized_name);

ALTER TABLE tasks
  ADD CONSTRAINT tasks_user_note_fingerprint_key UNIQUE (user_id, note_id, source_fingerprint);
