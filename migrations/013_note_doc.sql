-- A note's rich text as the editor keeps it (Tiptap's JSON document):
-- headings, lists that nest, checklists, indents on any line, links. The
-- `content` column stays as its Markdown version, which search, the AI,
-- previews and the web app read. Null for notes written before rich text,
-- and after a plain-text edit (the web app's), which replaces the words the
-- document had; the app then reads the Markdown instead.
-- Apply before deploying code that reads it: every note query selects it.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS doc jsonb;
