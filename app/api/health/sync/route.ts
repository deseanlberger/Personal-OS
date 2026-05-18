import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

type HealthSample = {
  steps?: number;
  active_calories?: number;
  resting_calories?: number;
  distance_mi?: number;
  exercise_min?: number;
  resting_hr?: number;
  hrv_ms?: number;
  weight_lb?: number;
  source?: string; // 'apple_health', 'manual', etc.
};

type Notes = {
  health?: HealthSample & { updated_at?: string };
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

/**
 * POST /api/health/sync — Apple Health iOS Shortcut posts here.
 *
 * Body: { date?: 'YYYY-MM-DD', steps?, active_calories?, resting_calories?,
 *         distance_mi?, exercise_min?, resting_hr?, hrv_ms?, weight_lb?, source? }
 * If date omitted, uses today (in user's TZ).
 *
 * Auth: x-api-secret header (handled in middleware allowlist for /api/health/*).
 * Idempotent: overwrites today's health entry on each call.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : localDateKey();

  // Load current day
  const { data: existing } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', date)
    .maybeSingle();

  const notes = parseNotes(existing?.notes ?? null);

  const sample: HealthSample & { updated_at: string } = {
    ...notes.health,
    updated_at: new Date().toISOString(),
    source: body.source || 'apple_health',
  };

  for (const field of ['steps', 'active_calories', 'resting_calories', 'distance_mi', 'exercise_min', 'resting_hr', 'hrv_ms', 'weight_lb'] as const) {
    const v = body[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      (sample as Record<string, unknown>)[field] = v;
    }
  }

  notes.health = sample;

  const { error } = await supabase
    .from('daily_logs')
    .upsert(
      {
        user_id: USER_ID,
        log_date: date,
        notes: JSON.stringify(notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,log_date' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ date, health: sample });
}

/** GET /api/health/sync — return today's stored health sample */
export async function GET() {
  const date = localDateKey();
  const { data } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', date)
    .maybeSingle();
  const notes = parseNotes(data?.notes ?? null);
  return NextResponse.json({ date, health: notes.health || null });
}
