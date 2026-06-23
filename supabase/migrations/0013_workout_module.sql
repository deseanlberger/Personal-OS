-- Workout module v1: strength logging + running ingest
--
-- Architecture:
--   • exercises is the canonical lift library. Names normalized + alias[] so
--     "bench", "BB bench", "barbell bench press" all collapse to one row.
--   • workout_sessions is the parent record. Polymorphic via session_type;
--     strength sessions own rows in strength_sets, running sessions own a
--     row in running_sessions (1:1 keyed by session_id).
--   • calendar_block_id is the same deterministic text key tasks use
--     (e.g. 'MON-05:30'). Not a real FK — block templates aren't a stable
--     row reference, they're rebuilt at runtime.
--   • e1RM is NEVER stored. Views compute it from raw weight + reps via
--     the Epley formula so we can't desync derived values from truth.

-- ---------------------------------------------------------------------------
-- exercises
-- ---------------------------------------------------------------------------

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  canonical_name text not null,
  aliases text[] not null default '{}',
  movement_pattern text not null check (movement_pattern in (
    'horizontal_press', 'vertical_press', 'horizontal_pull', 'vertical_pull',
    'squat', 'hinge', 'lunge', 'carry', 'core', 'arms', 'accessory'
  )),
  muscle_group text not null check (muscle_group in (
    'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads',
    'hamstrings', 'glutes', 'calves', 'core', 'full_body', 'arms'
  )),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, canonical_name)
);

create index if not exists exercises_user_active_idx on exercises(user_id, is_active);
-- GIN index lets the parser match "bench" against aliases array fast
create index if not exists exercises_aliases_gin on exercises using gin (aliases);

alter table exercises enable row level security;
create policy "deny_all_exercises" on exercises for all using (false);

-- Seed: upper-body pressing library (in scope for v1).
-- Aliases include common Telegram shorthand the parser will see in voice/text
-- captures. Add more aliases as Desean uses them.
insert into exercises (canonical_name, aliases, movement_pattern, muscle_group) values
  ('Barbell Bench Press',     array['bench', 'bb bench', 'flat bench', 'barbell bench', 'bp'],            'horizontal_press', 'chest'),
  ('Incline Barbell Bench',   array['incline bench', 'incline bb', 'incline barbell'],                    'horizontal_press', 'chest'),
  ('Dumbbell Bench Press',    array['db bench', 'dumbbell bench', 'flat db'],                             'horizontal_press', 'chest'),
  ('Incline Dumbbell Bench',  array['incline db', 'incline dumbbell', 'incline db bench'],                'horizontal_press', 'chest'),
  ('Overhead Press',          array['ohp', 'overhead', 'shoulder press', 'press', 'barbell ohp'],          'vertical_press',   'shoulders'),
  ('Dumbbell Shoulder Press', array['db shoulder press', 'db ohp', 'db press'],                            'vertical_press',   'shoulders'),
  ('Cable Fly',               array['fly', 'cable flys', 'cable flies', 'pec fly'],                        'horizontal_press', 'chest'),
  ('Dumbbell Fly',            array['db fly', 'db flys', 'db flies'],                                      'horizontal_press', 'chest'),
  ('Dips',                    array['dip', 'parallel bar dips', 'bar dips'],                               'horizontal_press', 'chest'),
  ('Push-Up',                 array['pushup', 'push ups', 'pushups'],                                      'horizontal_press', 'chest'),
  ('Close-Grip Bench',        array['cg bench', 'close grip', 'close-grip', 'narrow bench'],               'horizontal_press', 'triceps'),
  ('Tricep Pushdown',         array['pushdown', 'cable pushdown', 'tricep push down'],                     'arms',             'triceps'),
  ('Skullcrusher',            array['skull crusher', 'lying tricep extension', 'lte'],                     'arms',             'triceps')
on conflict (user_id, canonical_name) do nothing;

-- ---------------------------------------------------------------------------
-- workout_sessions  (parent)
-- ---------------------------------------------------------------------------

create table if not exists workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  session_date date not null,
  session_type text not null check (session_type in ('strength', 'running')),
  -- Reuses the block_templates.type enum so the workout module shares the
  -- calendar's vocabulary. Strength/running sessions both land on 'personal'
  -- blocks today; leaving the column flexible for the future.
  category text not null default 'personal' check (category in (
    'deep-thinking', 'deep-admin', 'multitask-admin', 'meeting',
    'coaching', 'personal', 'flex'
  )),
  -- Deterministic text key like 'MON-05:30'. Not a real FK — same pattern as
  -- tasks.assigned_block_id. Read-only link; module doesn't write into blocks.
  calendar_block_id text,
  notes text,
  -- Flag for sessions parsed from a capture but not yet confirmed by the user.
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_sessions_user_date_idx on workout_sessions(user_id, session_date desc);
create index if not exists workout_sessions_type_date_idx on workout_sessions(user_id, session_type, session_date desc);
create index if not exists workout_sessions_block_idx on workout_sessions(calendar_block_id)
  where calendar_block_id is not null;

alter table workout_sessions enable row level security;
create policy "deny_all_workout_sessions" on workout_sessions for all using (false);

-- ---------------------------------------------------------------------------
-- strength_sets  (child of workout_sessions, one row per set)
-- ---------------------------------------------------------------------------

create table if not exists strength_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references workout_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete restrict,
  set_number int not null check (set_number > 0),
  weight numeric(6, 2) not null check (weight >= 0),
  reps int not null check (reps > 0 and reps <= 100),
  rpe numeric(3, 1) check (rpe is null or (rpe >= 1 and rpe <= 10)),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists strength_sets_session_idx on strength_sets(session_id, set_number);
create index if not exists strength_sets_exercise_date_idx on strength_sets(exercise_id, created_at desc);

alter table strength_sets enable row level security;
create policy "deny_all_strength_sets" on strength_sets for all using (false);

-- ---------------------------------------------------------------------------
-- running_sessions  (child of workout_sessions, 1:1 keyed by session_id)
-- ---------------------------------------------------------------------------

create table if not exists running_sessions (
  session_id uuid primary key references workout_sessions(id) on delete cascade,
  run_type text not null check (run_type in ('sprint', 'distance', 'intervals')),
  -- Stored in meters so we don't carry unit ambiguity. Dashboard converts to mi.
  distance_m numeric(8, 2) not null check (distance_m > 0),
  duration_s int not null check (duration_s > 0),
  -- Seconds-per-mile pace (computed but stored for fast charting; trades a
  -- little redundancy for cheap reads on the trend view).
  avg_pace_s_per_mi numeric(8, 2),
  -- Per-split detail when available from Apple Health: [{ "split_mi": 1,
  -- "duration_s": 540, "elev_gain_m": 3 }, ...]
  splits jsonb,
  -- For dedup when Apple Health imports replay the same workout
  apple_health_uuid text,
  source text not null default 'apple_health' check (source in (
    'apple_health', 'shortcut', 'manual', 'garmin'
  )),
  created_at timestamptz not null default now()
);

create index if not exists running_sessions_health_uuid_idx on running_sessions(apple_health_uuid)
  where apple_health_uuid is not null;

alter table running_sessions enable row level security;
create policy "deny_all_running_sessions" on running_sessions for all using (false);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Epley e1RM per set + per-session best-e1RM per exercise. Derived view —
-- recompute on every read so it can't drift from raw sets.
create or replace view v_strength_set_e1rm as
select
  ss.id                                                                   as set_id,
  ss.session_id,
  ss.exercise_id,
  e.canonical_name                                                        as exercise_name,
  e.movement_pattern,
  e.muscle_group,
  ws.session_date,
  ss.set_number,
  ss.weight,
  ss.reps,
  ss.rpe,
  round((ss.weight * (1.0 + ss.reps / 30.0))::numeric, 2)                  as e1rm
from strength_sets ss
join exercises e            on e.id = ss.exercise_id
join workout_sessions ws    on ws.id = ss.session_id;

-- One row per (exercise, session_date) with the best top-set weight and best
-- e1RM observed that day. This is the primary trend chart datasource.
create or replace view v_strength_pr_trend as
select
  exercise_id,
  exercise_name,
  movement_pattern,
  session_date,
  max(weight)             as best_top_weight,
  max(e1rm)               as best_e1rm,
  count(*)                as sets
from v_strength_set_e1rm
group by exercise_id, exercise_name, movement_pattern, session_date;

-- Volume (sets x reps x weight) bucketed by movement pattern per week.
-- For balance checks: am I doing too much horizontal_press vs vertical_press?
create or replace view v_strength_volume_by_pattern as
select
  e.movement_pattern,
  date_trunc('week', ws.session_date)::date                  as week_start,
  sum(ss.weight * ss.reps)                                    as tonnage,
  sum(ss.reps)                                                as total_reps,
  count(distinct ws.id)                                       as sessions
from strength_sets ss
join exercises e          on e.id = ss.exercise_id
join workout_sessions ws  on ws.id = ss.session_id
group by e.movement_pattern, date_trunc('week', ws.session_date);
