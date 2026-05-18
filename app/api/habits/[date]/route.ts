import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

type Notes = {
  habits?: {
    // New schema: per-habit numeric value (count or minutes) for this day
    entries?: Record<string, number>;
    // Legacy: pre-V2 done set (preserved for back-compat reads)
    done?: string[];
    updated_at?: string;
  };
  [key: string]: unknown;
};

function parseNotes(raw: string | null): Notes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function loadDay(date: string): Promise<Notes> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', date)
    .maybeSingle();
  if (error) {
    console.error('[habits.load]', error.message);
    return {};
  }
  return parseNotes(data?.notes ?? null);
}

async function saveDay(date: string, notes: Notes): Promise<void> {
  const payload = {
    user_id: USER_ID,
    log_date: date,
    notes: JSON.stringify(notes),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('daily_logs')
    .upsert(payload, { onConflict: 'user_id,log_date' });
  if (error) throw new Error(error.message);
}

/** Monday-anchored: date keys for the 7 days of the week containing `today`. */
function weekDateKeys(today: string): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sun ... 6=Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + offsetToMon);
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(date);
    dd.setUTCDate(date.getUTCDate() + i);
    keys.push(dd.toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * GET /api/habits/[date]
 * Returns:
 *   { date, entries }       — values for this date only
 *   { week_entries }        — sum of entries across this date's Mon→Sun
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const weekKeys = weekDateKeys(date);
  const { data, error } = await supabase
    .from('daily_logs')
    .select('log_date,notes')
    .eq('user_id', USER_ID)
    .in('log_date', weekKeys);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const todayEntries: Record<string, number> = {};
  const weekEntries: Record<string, number> = {};
  for (const row of data || []) {
    const notes = parseNotes((row as { notes: string | null }).notes);
    const entries = notes.habits?.entries || {};
    const rowDate = (row as { log_date: string }).log_date;
    for (const [k, v] of Object.entries(entries)) {
      weekEntries[k] = (weekEntries[k] || 0) + (typeof v === 'number' ? v : 0);
      if (rowDate === date) todayEntries[k] = typeof v === 'number' ? v : 0;
    }
  }

  return NextResponse.json({
    date,
    entries: todayEntries,
    week_entries: weekEntries,
    week_start: weekKeys[0],
    week_end: weekKeys[6],
  });
}

/**
 * POST /api/habits/[date]  body: { habit_id, delta }
 *   delta: integer to add to today's value (can be negative to undo).
 *   Result clamped to >= 0.
 * Returns the updated entries map + recomputed week aggregate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.habit_id !== 'string' || typeof body.delta !== 'number') {
    return NextResponse.json({ error: 'habit_id + delta required' }, { status: 400 });
  }
  if (!Number.isFinite(body.delta)) {
    return NextResponse.json({ error: 'delta must be finite' }, { status: 400 });
  }

  const notes = await loadDay(date);
  const entries = { ...(notes.habits?.entries || {}) };
  const current = entries[body.habit_id] || 0;
  const next = Math.max(0, current + body.delta);
  entries[body.habit_id] = next;

  notes.habits = {
    ...notes.habits,
    entries,
    updated_at: new Date().toISOString(),
  };

  try {
    await saveDay(date, notes);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // Recompute week aggregate
  const weekKeys = weekDateKeys(date);
  const { data } = await supabase
    .from('daily_logs')
    .select('log_date,notes')
    .eq('user_id', USER_ID)
    .in('log_date', weekKeys);
  const weekEntries: Record<string, number> = {};
  for (const row of data || []) {
    const n = parseNotes((row as { notes: string | null }).notes);
    for (const [k, v] of Object.entries(n.habits?.entries || {})) {
      weekEntries[k] = (weekEntries[k] || 0) + (typeof v === 'number' ? v : 0);
    }
  }

  return NextResponse.json({ date, entries, week_entries: weekEntries });
}
