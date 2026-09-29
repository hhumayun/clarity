-- Notes and tasks, many to many. A task can be linked to any number of notes
-- and a note to any number of tasks; unlinking removes the link only.
--
-- tasks.note_id stays, meaning only "the note this task was found in": Find
-- tasks relies on it (with source_fingerprint) to never suggest the same
-- task twice. Linking never changes it. notes.task_id stays too, marking
-- the task a thought was parked from during focus time.
--
-- Additive only, so code from before this migration keeps working: apply it
-- BEFORE deploying the code that reads note_tasks.

CREATE TABLE IF NOT EXISTS note_tasks (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, task_id)
);

CREATE INDEX IF NOT EXISTS note_tasks_user_task_idx ON note_tasks (user_id, task_id);

-- Today's links carry over: every task's own note, and every parked thought's
-- task. Only where both belong to the same person.
INSERT INTO note_tasks (note_id, task_id, user_id, created_at)
SELECT t.note_id, t.id, t.user_id, t.created_at
FROM tasks t
JOIN notes n ON n.id = t.note_id AND n.user_id = t.user_id
WHERE t.note_id IS NOT NULL AND t.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO note_tasks (note_id, task_id, user_id, created_at)
SELECT n.id, n.task_id, n.user_id, n.created_at
FROM notes n
JOIN tasks t ON t.id = n.task_id AND t.user_id = n.user_id
WHERE n.task_id IS NOT NULL AND t.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- The AI summary of a task's notes and focus time, kept until what it was
-- made from changes (input_hash).
CREATE TABLE IF NOT EXISTS task_summaries (
  task_id     TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_hash  TEXT NOT NULL,
  summary     TEXT NOT NULL,
  -- JSON text: [{"date":"YYYY-MM-DD","text":"..."}], oldest first.
  progress    TEXT NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
