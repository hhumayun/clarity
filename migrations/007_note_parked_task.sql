-- A thought parked during focus time remembers the task being worked on, so
-- that task shows in the parked note's Tasks section. It does not move the
-- task out of the note it belongs to (tasks.note_id): many parked thoughts
-- can point at the same task. Deleting the task just clears the link.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
