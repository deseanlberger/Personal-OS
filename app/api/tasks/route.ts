import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { classifyCapture } from '@/lib/router/classifyCapture';
import { embed } from '@/lib/embeddings';
import { recalcWeek } from '@/lib/blocks/recalc';
import type { Urgency } from '@/lib/types';

const URGENCIES: Urgency[] = ['today', 'this_week', 'this_month', 'someday'];
const USER_ID = process.env.USER_ID || 'desean';

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

  const title = String(body.title).trim();

  // If the client didn't specify a category, ask the classifier to fill in
  // category/energy/estimated_minutes from the title. Title-only is enough
  // context for short tasks; falls back gracefully when the LLM is offline.
  let category: string | null = body.category || null;
  let energy: string | null = body.energy || null;
  let estimatedMinutes: number | null = body.estimated_minutes || null;
  let inferredTags: string[] = Array.isArray(body.tags) ? body.tags : [];

  if (!category) {
    try {
      const { classification } = await classifyCapture(title);
      category = classification.category;
      energy = energy || classification.energy;
      estimatedMinutes = estimatedMinutes || classification.estimated_minutes;
      if (inferredTags.length === 0 && classification.tags.length > 0) {
        inferredTags = classification.tags;
      }
    } catch (err) {
      console.error('[/api/tasks POST] auto-classify failed:', (err as Error).message);
    }
  }

  // Guarantee: every task has a category. Fall back to 'flex' if the
  // classifier couldn't determine one (or wasn't called). 'flex' blocks
  // accept any task in the recalc engine, so the task at least lands somewhere.
  if (!category) category = 'flex';

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: USER_ID,
      title,
      description: body.description || null,
      urgency: URGENCIES.includes(body.urgency) ? body.urgency : 'someday',
      key: !!body.key,
      category,
      energy,
      estimated_minutes: estimatedMinutes,
      tags: inferredTags,
      due_date: body.due_date || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort: embed the task text so it shows up in /brain search.
  if (data?.id) {
    embed(title)
      .then(async (vec) => {
        if (!vec) return;
        await supabase.from('memory_chunks').insert({
          user_id: USER_ID,
          source_type: 'task',
          source_id: data.id,
          text: title,
          embedding: vec as unknown as string,
        });
      })
      .catch((err: Error) => console.error('[/api/tasks POST] embed failed:', err.message));
  }

  // Always trigger recalc so the new task lands in a matching block.
  recalcWeek().catch((err) => console.error('[/api/tasks POST] recalc failed:', err.message));

  return NextResponse.json({ task: data });
}
