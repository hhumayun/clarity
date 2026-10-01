-- remind_at (010) gave way to remind_before (011), and nothing reads it any
-- more. Apply only once the code from 011 is deployed: the code before it
-- still selects this column.

ALTER TABLE tasks DROP COLUMN IF EXISTS remind_at;
