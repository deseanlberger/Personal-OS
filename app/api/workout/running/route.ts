import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * POST /api/workout/running — iOS Shortcut posts here after a run.
 *
 * Shortcut payload shape (see docs/SHORTCUTS_RUNNING.md):
 *   {
 *     "run_type": "sprint" | "distance" | "intervals",
 *     "distance_m": 1609.34,                 // required, meters
 *     "duration_s": 540,                     // required, seconds
 *     "session_date": "YYYY-MM-DD",          // optional, defaults to today
 *     "avg_pace_s_per_mi": 540,              // optional; computed if omitted
 *     "splits": [                            // optional Apple Health splits
 *       { "split_mi": 1, "duration_s": 540, "elev_gain_m": 3 }
 *     ],
 *     "apple_health_uuid": "ABC-123-DEF",    // optional, for dedup
 *     "notes": "..."                          // optional
 *   }
 *
 * Auth: middleware lets the request through with x-api-secret header.
 * Dedup: apple_health_uuid is unique-indexed; replays return the existing row.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 });

  const distance_m = Number(body.distance_m);
  const duration_s = Number(body.duration_s);
  if (!Number.isFinite(distance_m) || distance_m <= 0) {
    return NextResponse.json({ error: 'distance_m required (positive number)' }, { status: 400 });
  }
  if (!Number.isFinite(duration_s) || duration_s <= 0) {
    return NextResponse.json({ error: 'duration_s required (positive number)' }, { status: 400 });
  }
  const run_type = ['sprint', 'distance', 'intervals'].includes(body.run_type) ? body.run_type : 'distance';
  const sessionDate = typeof body.session_date === 'string' ? body.session_date : localDateKey();

  // Pace: seconds per mile. Compute if Apple Health didn't supply it.
  const METERS_PER_MILE = 1609.344;
  const miles = distance_m / METERS_PER_MILE;
  const avg_pace_s_per_mi = Number.isFinite(Number(body.avg_pace_s_per_mi))
    ? Number(body.avg_pace_s_per_mi)
    : Math.round(duration_s / miles);

  const apple_health_uuid: string | null = typeof body.apple_health_uuid === 'string'
    ? body.apple_health_uuid
    : null;

  // Dedup: same Apple Health workout pushed twice should NOT create two rows.
  if (apple_health_uuid) {
    const { data: existing } = await supabase
      .from('running_sessions')
      .select('session_id, workout_sessions!inner(id, session_date)')
      .eq('apple_health_uuid', apple_health_uuid)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, session_id: existing.session_id });
    }
  }

  // Insert parent session, then child running_sessions row.
  const { data: session, error: sessionErr } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: USER_ID,
      session_date: sessionDate,
      session_type: 'running',
      category: 'personal',
      notes: typeof body.notes === 'string' ? body.notes : null,
      needs_review: false,
    })
    .select('id')
    .single();
  if (sessionErr || !session) {
    return NextResponse.json({ error: sessionErr?.message || 'session insert failed' }, { status: 500 });
  }

  const { error: runErr } = await supabase.from('running_sessions').insert({
    session_id: session.id,
    run_type,
    distance_m,
    duration_s,
    avg_pace_s_per_mi,
    splits: Array.isArray(body.splits) ? body.splits : null,
    apple_health_uuid,
    source: typeof body.source === 'string' ? body.source : 'apple_health',
  });
  if (runErr) {
    // Roll back the parent so we don't leave orphan workout_sessions.
    await supabase.from('workout_sessions').delete().eq('id', session.id);
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    distance_mi: Number(miles.toFixed(2)),
    duration_s,
    pace: `${Math.floor(avg_pace_s_per_mi / 60)}:${String(avg_pace_s_per_mi % 60).padStart(2, '0')}/mi`,
  });
}

/**
 * GET /api/workout/running?days=30 — list recent runs + totals.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') || 30), 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id, session_date, notes, running_sessions!inner(run_type, distance_m, duration_s, avg_pace_s_per_mi)')
    .eq('user_id', USER_ID)
    .eq('session_type', 'running')
    .gte('session_date', since.toISOString().slice(0, 10))
    .order('session_date', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    session_date: string;
    notes: string | null;
    running_sessions: { run_type: string; distance_m: number; duration_s: number; avg_pace_s_per_mi: number | null };
  };
  const sessions = (data || []) as unknown as Row[];
  const METERS_PER_MILE = 1609.344;

  const totals = sessions.reduce(
    (acc, s) => {
      const r = s.running_sessions;
      acc.total_distance_m += Number(r.distance_m);
      acc.total_duration_s += Number(r.duration_s);
      if (r.run_type === 'sprint') acc.sprint_count++;
      else if (r.run_type === 'distance') acc.distance_count++;
      else if (r.run_type === 'intervals') acc.intervals_count++;
      return acc;
    },
    { total_distance_m: 0, total_duration_s: 0, sprint_count: 0, distance_count: 0, intervals_count: 0 },
  );

  return NextResponse.json({
    days,
    sessions: sessions.map((s) => ({
      id: s.id,
      session_date: s.session_date,
      run_type: s.running_sessions.run_type,
      distance_mi: Number((Number(s.running_sessions.distance_m) / METERS_PER_MILE).toFixed(2)),
      duration_s: Number(s.running_sessions.duration_s),
      avg_pace_s_per_mi: Number(s.running_sessions.avg_pace_s_per_mi),
      notes: s.notes,
    })),
    totals: {
      total_distance_mi: Number((totals.total_distance_m / METERS_PER_MILE).toFixed(2)),
      total_duration_s: totals.total_duration_s,
      sprint_count: totals.sprint_count,
      distance_count: totals.distance_count,
      intervals_count: totals.intervals_count,
    },
  });
}
