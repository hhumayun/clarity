-- The notes list pages through a person's notes newest-written first, and
-- the journal asks for a week by date. Both filter on user and archived and
-- walk created_at, which the plain user_id index cannot order by.
CREATE INDEX IF NOT EXISTS notes_user_archived_created_idx
  ON notes (user_id, archived, created_at DESC, id DESC);
