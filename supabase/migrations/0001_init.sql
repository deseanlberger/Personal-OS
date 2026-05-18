-- Personal OS — initial schema
-- 7 tables: app_meta, entities, raw_captures, tasks (extended), daily_logs, memory_chunks, audit_log
-- RLS deny-all by default; service-role key bypasses RLS.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ─── app_meta ─────────────────────────────────────────────────────
-- Key/value store. Replaces command-center's SQLite cc_meta table.
-- Holds cc_week_label ('A' | 'B'), cc_calendar_id, and similar.
create table app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ─── entities ─────────────────────────────────────────────────────
-- People, orgs, projects referenced by tasks and captures.
create table entities (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  name text not null,
  kind text not null check (kind in ('person', 'org', 'project', 'topic')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index entities_user_idx on entities(user_id);
create index entities_name_idx on entities(name);

-- ─── raw_captures ─────────────────────────────────────────────────
-- Every voice/text input lands here first, before routing.
create table raw_captures (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  source text not null check (source in ('telegram', 'web', 'ios_shortcut', 'api')),
  raw_text text not null,
  audio_url text,
  classification jsonb not null default '{}'::jsonb,
  llm_source text,
  routed_to text,
  routed_id uuid,
  created_at timestamptz not null default now()
);
create index raw_captures_user_created_idx on raw_captures(user_id, created_at desc);

-- ─── tasks ────────────────────────────────────────────────────────
-- Extended beyond Miles's spec with block-engine fields (category, energy,
-- estimated_minutes, momentum_score, assigned_block_id) ported from command-center.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  title text not null,
  description text,
  urgency text not null default 'someday' check (urgency in ('today', 'this_week', 'this_month', 'someday')),
  key boolean not null default false,
  priority_score real not null default 0,
  -- Block engine fields (Desean's extension, not in Miles's spec)
  category text check (category in ('deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'personal', 'flex')),
  energy text check (energy in ('high', 'med', 'low')),
  estimated_minutes integer,
  is_pinned boolean not null default false,
  momentum_score real not null default 0,
  assigned_block_id text,
  -- Standard fields
  tags text[] not null default '{}',
  due_date date,
  owner text,
  entity_id uuid references entities(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_open_idx on tasks(user_id) where completed_at is null;
create index tasks_urgency_open_idx on tasks(urgency) where completed_at is null;
create index tasks_cat_energy_open_idx on tasks(category, energy) where completed_at is null;
create index tasks_entity_idx on tasks(entity_id) where entity_id is not null;

-- ─── daily_logs ───────────────────────────────────────────────────
-- One row per (user, date). notes column holds JSON for habits, nutrition,
-- finance snapshot, goals. Goals live on a SENTINEL date (2000-01-01) so
-- they never auto-clear at week/month boundaries.
create table daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  log_date date not null,
  notes text,
  mood text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);
create index daily_logs_user_date_idx on daily_logs(user_id, log_date desc);

-- ─── memory_chunks ────────────────────────────────────────────────
-- Vector embeddings of every text artifact for semantic search.
create table memory_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  source_type text not null check (source_type in ('capture', 'task', 'journal', 'habit', 'meal', 'goal', 'decision', 'note')),
  source_id uuid not null,
  text text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index memory_chunks_user_idx on memory_chunks(user_id);
-- ivfflat index for cosine similarity search. Optimal lists ≈ sqrt(rows);
-- 100 is fine for early use, can be rebuilt later as data grows.
create index memory_chunks_embedding_idx on memory_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── audit_log ────────────────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_created_idx on audit_log(user_id, created_at desc);

-- ─── RLS (deny-all, service role bypasses) ────────────────────────
alter table app_meta       enable row level security;
alter table entities       enable row level security;
alter table raw_captures   enable row level security;
alter table tasks          enable row level security;
alter table daily_logs     enable row level security;
alter table memory_chunks  enable row level security;
alter table audit_log      enable row level security;

-- Seed: Week A as the starting label (port from command-center scheduler default)
insert into app_meta (key, value) values ('cc_week_label', 'A') on conflict (key) do nothing;
