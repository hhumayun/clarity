-- A task can carry a longer description under its one-line text: the
-- details, links or steps that do not belong in the title. Empty by default,
-- so every existing task simply has none.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
