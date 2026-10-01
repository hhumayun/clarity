-- Reminders: a time on a task, once or repeating.
--
-- remind_at is the reminder's time, or for a repeating one the time its
-- series counts from (each time a repeating task is ticked off, it moves on
-- to the next one). remind_repeat is null for a one-off reminder.
--
-- The phone schedules the notifications itself (local notifications), so
-- nothing on the server sends anything at these times.
--
-- Additive only, so code from before this migration keeps working: apply it
-- BEFORE deploying the code that reads these columns.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_repeat TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_remind_repeat_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_remind_repeat_check
      CHECK (remind_repeat IS NULL OR remind_repeat IN ('daily', 'weekdays', 'weekly', 'monthly'));
  END IF;
END $$;
