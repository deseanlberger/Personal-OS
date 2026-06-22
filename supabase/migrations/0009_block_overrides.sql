-- One-off schedule overrides. When Desean has to cover for someone,
-- a doctor's appointment, or any other date-specific deviation from
-- his Summer/School Year preset, the override lands here.
--
-- The /api/calendar/blocks endpoint merges these on top of the template
-- for any requested week. Recalc skips them (locked by default) so tasks
-- get routed around the override.

create table if not exists block_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  override_date date not null,
  start_time text not null,
  end_time text not null,
  name text not null,
  type text not null check (type in ('deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'coaching', 'personal', 'flex')),
  energy text check (energy in ('high', 'med', 'low')),
  locked boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists block_overrides_user_date_idx on block_overrides(user_id, override_date);
alter table block_overrides enable row level security;
