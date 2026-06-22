import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

const VALID_TYPES = new Set(['deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'coaching', 'personal', 'flex']);
const VALID_ENERGIES = new Set(['high', 'med', 'low']);
const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/calendar/overrides?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Lists overrides in the inclusive date range. Defaults to today → +14 days.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = DATE_RE.test(searchParams.get('from') || '') ? searchParams.get('from')! : today;
  const toDate = new Date();
  toDate.setDate(toDate.getDate() + 14);
  const to = DATE_RE.test(searchParams.get('to') || '') ? searchParams.get('to')! : toDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('block_overrides')
    .select('*')
    .eq('user_id', USER_ID)
    .gte('override_date', from)
    .lte('override_date', to)
    .order('override_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ overrides: data || [] });
}

/**
 * POST /api/calendar/overrides
 * { override_date, start_time, end_time, name, type, energy?, notes? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  if (!DATE_RE.test(body.override_date)) {
    return NextResponse.json({ error: 'override_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!TIME_RE.test(body.start_time) || !TIME_RE.test(body.end_time)) {
    return NextResponse.json({ error: 'start_time and end_time must be HH:MM (24h)' }, { status: 400 });
  }
  if (body.end_time <= body.start_time) {
    return NextResponse.json({ error: 'end_time must be after start_time' }, { status: 400 });
  }
  if (!VALID_TYPES.has(body.type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  if (body.energy && !VALID_ENERGIES.has(body.energy)) {
    return NextResponse.json({ error: 'invalid energy' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const { data, error } = await supabase
    .from('block_overrides')
    .insert({
      user_id: USER_ID,
      override_date: body.override_date,
      start_time: body.start_time,
      end_time: body.end_time,
      name,
      type: body.type,
      energy: body.energy || null,
      locked: body.locked ?? true,
      notes: body.notes || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ override: data });
}
