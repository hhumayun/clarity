-- A reminder for this time only. A task's repeat (remind_repeat) and its
-- reminder (remind_before) are separate; until now a repeating task's
-- reminder went off each time it came back. remind_once says the reminder is
-- for this time only: when the repeating task comes back, it has none.
--
-- Additive, with a default that keeps every existing reminder as it was
-- (each time). Apply it BEFORE deploying the code that reads the column
-- (helpers/taskRecords.tsx selects it for every task list).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_once BOOLEAN NOT NULL DEFAULT false;
