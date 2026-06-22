-- Drop the source check constraint. It was originally limited to
-- 'manual' / 'photo' / 'gmail' / 'sheet_import' but the statement
-- upload feature (PR #25) writes descriptive sources like
-- 'statement-Apple_Card_Statement.pdf' and the bulk endpoint
-- writes 'bulk', 'chase-statement', etc.

alter table transactions drop constraint if exists transactions_source_check;
