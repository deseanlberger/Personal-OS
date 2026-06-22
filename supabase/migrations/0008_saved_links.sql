-- Saved links — Desean drops a URL into Telegram (or via /library) and
-- Jarvis fetches the title/description, classifies it, and files it for later.
-- Embeddings come for free since each link is also written to memory_chunks
-- and shows up in /brain search.

create table if not exists saved_links (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  url text not null,
  domain text,
  source_kind text check (source_kind in ('youtube', 'instagram', 'twitter', 'tiktok', 'article', 'other')),
  title text,
  description text,
  thumbnail_url text,
  summary text,
  category text,
  tags text[] not null default '{}',
  raw_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_links_user_idx on saved_links(user_id, created_at desc);
create index if not exists saved_links_category_idx on saved_links(category);
alter table saved_links enable row level security;
