-- Adds assigned_week_offset so the block engine can place tasks into
-- next week when this week is full. 0 = current week (default), 1 = next, etc.
-- Tasks with assigned_block_id but no matching slot this week now overflow
-- forward instead of sitting unassigned.

alter table tasks add column if not exists assigned_week_offset integer not null default 0;

create index if not exists tasks_assigned_week_idx
  on tasks(assigned_week_offset)
  where assigned_block_id is not null;
