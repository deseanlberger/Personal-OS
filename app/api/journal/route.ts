import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';
const DEFAULT_LIMIT = 100;

/**
 * GET /api/journal?days=30&q=keyword
 * Returns raw_captures where the classifier tagged them as journal/note/decision
 * (i.e. anything that isn't routed to /crm as a task). Used by the /journal page.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') || 90), 1), 365);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || DEFAULT_LIMIT), 1), 500);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // PostgREST JSONB filter: classification ->> 'kind' in ('journal','note','decision','capture')
  // The 'in' operator on jsonb path is awkward, so just pull and filter in JS.
  // Scoped tight by date + limit so this stays cheap.
  let query = supabase
    .from('raw_captures')
    .select('id, raw_text, classification, llm_source, source, created_at')
    .eq('user_id', USER_ID)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit + (Date.now() % 100));

  if (q) {
    query = query.ilike('raw_text', `%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const NON_TASK_KINDS = new Set(['journal', 'note', 'capture', 'decision']);
  const entries = (data || [])
    .filter((row) => {
      const k = (row.classification as Record<string, unknown>)?.kind;
      return typeof k === 'string' && NON_TASK_KINDS.has(k);
    })
    .map((row) => {
      const c = (row.classification as Record<string, unknown>) || {};
      return {
        id: row.id,
        raw_text: row.raw_text,
        summary: typeof c.summary === 'string' ? c.summary : row.raw_text.slice(0, 140),
        kind: typeof c.kind === 'string' ? c.kind : 'capture',
        tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        source: row.source,
        created_at: row.created_at,
      };
    });

  return NextResponse.json({ entries, count: entries.length });
}
