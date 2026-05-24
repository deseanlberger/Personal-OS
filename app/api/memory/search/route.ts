import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { embed } from '@/lib/embeddings';

const USER_ID = process.env.USER_ID || 'desean';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.query || typeof body.query !== 'string') {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }
  const query = body.query.trim().slice(0, 1000);
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 50);

  const vec = await embed(query);
  if (!vec) {
    return NextResponse.json({ error: 'embedding failed — OPENAI_API_KEY missing?' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('search_memory', {
    query_embedding: vec as unknown as string,
    match_count: limit,
    user_id_filter: USER_ID,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ matches: data || [] });
}
