-- Rich text written before 2026-10-06 was encoded twice: the write handed the
-- driver a JSON string, which it encoded again, so the jsonb column holds a
-- string with the document inside it (jsonb_typeof = 'string'). Unwrap those
-- into the document itself. The server reads both forms (readableDoc), so this
-- is tidying, not a fix the apps wait on.
--
-- Only the doc column of notes whose doc is such a string changes; their
-- words, titles and updated_at stay as they are.
UPDATE notes
SET doc = (doc #>> '{}')::jsonb
WHERE jsonb_typeof(doc) = 'string'
  AND left(btrim(doc #>> '{}'), 1) = '{';
