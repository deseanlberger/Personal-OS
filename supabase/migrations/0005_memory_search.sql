-- Memory search RPC: cosine similarity over memory_chunks.embedding.
-- Called by /api/memory/search and /api/ask. Uses pgvector's <=> operator
-- (cosine distance); similarity = 1 - distance.

create or replace function search_memory(
  query_embedding vector(1536),
  match_count int default 20,
  user_id_filter text default 'desean'
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  text text,
  similarity float,
  created_at timestamptz
)
language sql
stable
as $$
  select
    mc.id,
    mc.source_type,
    mc.source_id,
    mc.text,
    1 - (mc.embedding <=> query_embedding) as similarity,
    mc.created_at
  from memory_chunks mc
  where mc.user_id = user_id_filter
    and mc.embedding is not null
  order by mc.embedding <=> query_embedding
  limit match_count;
$$;
