-- Guarantee: every task has a category.
-- Backfill any existing nulls to 'flex', then set DEFAULT so future direct
-- inserts (e.g. via SQL editor) also get a category instead of null.

update tasks set category = 'flex' where category is null;

alter table tasks alter column category set default 'flex';

-- Note: the existing CHECK constraint already validates the value:
-- check (category in ('deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'personal', 'flex'))
