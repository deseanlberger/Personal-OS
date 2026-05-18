import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import type { Urgency } from '@/lib/types';

const URGENCIES: Urgency[] = ['today', 'this_week', 'this_month', 'someday'];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'open'; // 'open' | 'done' | 'all'
  const urgency = searchParams.get('urgency'); // Urgency | null
  const key = searchParams.get('key'); // 'true' | 'false' | null
  const limit = Math.min(Number(searchParams.get('limit') || 100), 500);

  // Bust PostgREST edge cache (per cheat sheet Bug 8.5)
  let query = supabase
    .from('tasks')
    .select('*')
    .order('priority_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit + (Date.now() % 100));

  if (status === 'open') query = query.is('completed_at', null);
  else if (status === 'done') query = query.not('completed_at', 'is', null);

  if (urgency && URGENCIES.includes(urgency as Urgency)) {
    query = query.eq('urgency', urgency);
  }
  if (key === 'true') query = query.eq('key', true);
  if (key === 'false') query = query.eq('key', false);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tasks: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: process.env.USER_ID || 'desean',
      title: body.title,
      description: body.description || null,
      urgency: URGENCIES.includes(body.urgency) ? body.urgency : 'someday',
      key: !!body.key,
      category: body.category || null,
      energy: body.energy || null,
      estimated_minutes: body.estimated_minutes || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      due_date: body.due_date || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
