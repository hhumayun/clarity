-- Give text primary keys a database default so inserts can omit the id
-- (the app relies on this, e.g. notes/create inserts without an id).
-- Run with: psql "$DATABASE_URL" -f migrations/002_id_defaults.sql

ALTER TABLE notes ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE note_entities ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE projects ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE tasks ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE suggestion_events ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
