-- Block template moved from hard-coded TypeScript to Supabase so Desean can
-- edit names/times/sessions without redeploying. Seeded with the original
-- command-center template.
--
-- week_label semantics:
--   'shared' → applies to BOTH Week A and Week B (most blocks)
--   'A'      → only Week A (Tuesday/Wednesday Week A variants)
--   'B'      → only Week B (Tuesday/Wednesday Week B variants)
--
-- day: 0=Sun, 1=Mon, ..., 6=Sat

create table block_templates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  week_label text not null default 'shared' check (week_label in ('shared', 'A', 'B')),
  day int not null check (day >= 0 and day <= 6),
  start_time text not null,
  end_time text not null,
  name text not null,
  type text not null check (type in ('deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'coaching', 'personal', 'flex')),
  energy text check (energy in ('high', 'med', 'low')),
  locked boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index block_templates_user_idx on block_templates(user_id);
create index block_templates_week_day_idx on block_templates(week_label, day, start_time);
alter table block_templates enable row level security;

-- Seed: SHARED blocks (apply to both weeks)
insert into block_templates (week_label, day, start_time, end_time, name, type, energy, locked) values
  -- Monday (1)
  ('shared', 1, '05:40', '05:55', 'Transit to Odyssey', 'personal', null, true),
  ('shared', 1, '06:00', '07:15', 'Elite Group Coaching', 'coaching', null, true),
  ('shared', 1, '07:30', '08:30', 'Lauren Feiler', 'coaching', null, true),
  ('shared', 1, '08:30', '09:30', 'Workout Block', 'personal', null, true),
  ('shared', 1, '09:30', '10:15', 'Deep Admin', 'deep-admin', 'med', false),
  ('shared', 1, '10:15', '11:00', 'Transit Home / Buffer', 'personal', null, true),
  ('shared', 1, '11:15', '12:00', 'OTA Meeting / Admin', 'multitask-admin', 'low', false),
  ('shared', 1, '12:00', '13:40', 'Deep Thinking (2x)', 'deep-thinking', 'high', false),
  ('shared', 1, '13:50', '14:20', 'Deep Admin', 'deep-admin', 'med', false),
  ('shared', 1, '15:00', '15:15', 'Transit to Odyssey', 'personal', null, true),
  ('shared', 1, '15:15', '15:30', 'Annie Meeting', 'meeting', null, true),
  ('shared', 1, '15:40', '17:00', 'Gym Maintenance', 'multitask-admin', 'low', false),
  ('shared', 1, '17:00', '20:00', 'Sacred Floor Time', 'coaching', null, true),
  -- Thursday (4)
  ('shared', 4, '05:30', '06:30', 'Workout Block', 'personal', null, true),
  ('shared', 4, '06:45', '08:25', 'Deep Thinking (2x)', 'deep-thinking', 'high', false),
  ('shared', 4, '08:35', '09:55', 'Deep Admin (2x)', 'deep-admin', 'med', false),
  ('shared', 4, '10:05', '11:00', 'Planning / Treadmill', 'multitask-admin', 'low', false),
  ('shared', 4, '11:15', '12:45', 'Home Fuel / Reset', 'personal', null, true),
  ('shared', 4, '13:00', '15:00', 'Tri-City Session', 'coaching', null, true),
  ('shared', 4, '15:15', '15:30', 'Annie Meeting', 'meeting', null, true),
  ('shared', 4, '17:00', '20:00', 'Sacred Floor Time', 'coaching', null, true),
  -- Friday (5)
  ('shared', 5, '05:45', '06:00', 'Gym Setup', 'multitask-admin', 'low', false),
  ('shared', 5, '06:00', '07:15', 'SM Softball Coaching', 'coaching', null, true),
  ('shared', 5, '07:30', '09:00', 'Workout Block', 'personal', null, true),
  ('shared', 5, '09:00', '10:30', 'Deep Thinking', 'deep-thinking', 'high', false),
  ('shared', 5, '12:00', '14:00', 'Deep Thinking', 'deep-thinking', 'med', false),
  -- Saturday (6)
  ('shared', 6, '10:00', '11:30', 'Strategy & Ops Cleanup', 'flex', 'med', false),
  -- Sunday (0)
  ('shared', 0, '06:30', '08:00', 'Meal Prep & Planning', 'personal', null, true),
  ('shared', 0, '08:00', '09:00', 'Cohen Mugford', 'coaching', null, true);

-- Seed: TUESDAY Week A
insert into block_templates (week_label, day, start_time, end_time, name, type, energy, locked) values
  ('A', 2, '05:30', '06:30', 'Workout Block', 'personal', null, true),
  ('A', 2, '06:45', '08:25', 'Deep Thinking (2x)', 'deep-thinking', 'high', false),
  ('A', 2, '08:35', '09:55', 'Deep Admin (2x)', 'deep-admin', 'med', false),
  ('A', 2, '10:05', '11:00', 'Planning / Treadmill', 'multitask-admin', 'low', false),
  ('A', 2, '11:45', '12:45', 'Admin / Execution', 'multitask-admin', 'low', false),
  ('A', 2, '13:00', '15:00', 'Tri-City Session', 'coaching', null, true),
  ('A', 2, '15:15', '15:30', 'Annie Meeting', 'meeting', null, true),
  ('A', 2, '15:40', '17:00', 'Multi-Task Admin', 'multitask-admin', 'low', false);

-- Seed: TUESDAY Week B
insert into block_templates (week_label, day, start_time, end_time, name, type, energy, locked) values
  ('B', 2, '05:30', '06:30', 'Workout Block', 'personal', null, true),
  ('B', 2, '06:45', '08:25', 'Deep Thinking (2x)', 'deep-thinking', 'high', false),
  ('B', 2, '08:35', '09:55', 'Deep Admin (2x)', 'deep-admin', 'med', false),
  ('B', 2, '10:05', '11:00', 'Planning / Treadmill', 'multitask-admin', 'low', false),
  ('B', 2, '11:45', '12:45', 'Gabby Session', 'coaching', null, true),
  ('B', 2, '13:00', '15:00', 'Tri-City Session', 'coaching', null, true),
  ('B', 2, '15:15', '15:30', 'Annie Meeting', 'meeting', null, true),
  ('B', 2, '15:40', '17:00', 'Multi-Task Admin', 'multitask-admin', 'low', false);

-- Seed: WEDNESDAY Week A
insert into block_templates (week_label, day, start_time, end_time, name, type, energy, locked) values
  ('A', 3, '04:30', '06:10', 'Deep Thinking (2x)', 'deep-thinking', 'high', false),
  ('A', 3, '06:20', '07:20', 'Deep Admin', 'deep-admin', 'med', false),
  ('A', 3, '07:30', '09:00', 'Workout Block', 'personal', null, true),
  ('A', 3, '10:00', '11:00', 'OTA Meeting', 'multitask-admin', 'low', false),
  ('A', 3, '11:10', '11:50', 'Deep Admin', 'deep-admin', 'med', false),
  ('A', 3, '12:00', '13:00', 'Sacred Nap', 'personal', null, true),
  ('A', 3, '13:45', '14:45', 'Gabby Session', 'coaching', null, true),
  ('A', 3, '15:00', '15:30', 'Coaches Meeting', 'meeting', null, true),
  ('A', 3, '17:00', '20:00', 'Sacred Floor Time', 'coaching', null, true);

-- Seed: WEDNESDAY Week B
insert into block_templates (week_label, day, start_time, end_time, name, type, energy, locked) values
  ('B', 3, '04:30', '06:10', 'Deep Thinking (2x)', 'deep-thinking', 'high', false),
  ('B', 3, '06:20', '07:20', 'Deep Admin', 'deep-admin', 'med', false),
  ('B', 3, '07:30', '09:00', 'Workout Block', 'personal', null, true),
  ('B', 3, '10:00', '11:00', 'OTA Meeting', 'multitask-admin', 'low', false),
  ('B', 3, '11:10', '11:50', 'Deep Admin', 'deep-admin', 'med', false),
  ('B', 3, '12:00', '13:00', 'Sacred Nap', 'personal', null, true),
  ('B', 3, '13:45', '14:45', 'Deep Admin / Backlog', 'deep-admin', 'med', false),
  ('B', 3, '15:00', '15:30', 'Coaches Meeting', 'meeting', null, true),
  ('B', 3, '17:00', '20:00', 'Sacred Floor Time', 'coaching', null, true);
