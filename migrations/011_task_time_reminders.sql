-- A time on a task, and reminders counted back from it.
--
-- due_time is the task's time on its day (complete_by), as the writer's own
-- clock time, "HH:MM". Null means any time that day. It always goes with a
-- day: a task without a day has no time.
--
-- remind_before takes over from remind_at (migration 010): a reminder is now
-- so many minutes before the task's time or, for a task with no time, before
-- 9:00 on its day ("1 day before" is 9:00 the day before). Kept relative, a
-- reminder follows its task to another day or time. remind_repeat (010) is
-- how the task repeats.
--
-- Additive only, so the code running now keeps working: apply it BEFORE
-- deploying the code that reads these columns. 012 drops remind_at once that
-- code is live.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_before INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_due_time_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_due_time_check
      CHECK (due_time IS NULL OR due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_remind_before_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_remind_before_check
      CHECK (remind_before IS NULL OR (remind_before >= 0 AND remind_before <= 525600));
  END IF;
END $$;
