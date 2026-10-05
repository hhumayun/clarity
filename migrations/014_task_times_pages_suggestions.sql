-- Revamp 5 ("Sage") asks four small things of the server. Everything here
-- only adds, so a server running the code from before this migration simply
-- doesn't see it, and the main app keeps working. Safe to run twice.
-- Apply BEFORE deploying the code that reads it: every task query selects
-- completed_at and moved_from.

BEGIN;

-- When a task was done (cleared when it's reopened), and the day it was
-- planned for before Catch up or a move pushed it on. Tasks already done
-- take their last change as the best guess at when.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS moved_from TIMESTAMPTZ;
UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;

-- A note can be a day's page: the one written to Today's question.
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_source_check;
ALTER TABLE notes ADD CONSTRAINT notes_source_check CHECK (source IN ('focus', 'page'));

-- Find tasks' suggestions, kept until the writer adds or dismisses them, so
-- leaving a note no longer loses them. Dismissed ones stay, marked, so the
-- same words aren't offered again for that note. They go with their note.
CREATE TABLE IF NOT EXISTS task_suggestions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL,
  text          TEXT NOT NULL,
  project_name  TEXT NOT NULL DEFAULT '',
  complete_by   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT task_suggestions_note_fingerprint_key UNIQUE (note_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS task_suggestions_user_id_idx ON task_suggestions (user_id);

COMMIT;
