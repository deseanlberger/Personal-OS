import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/workout/sessions?days=90 — full session list for the dashboard.
 * Each strength session is hydrated with its sets (joined via strength_sets).
 * Each running session is hydrated with its details.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') || 90), 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: sessions, error } = await supabase
    .from('workout_sessions')
    .select(`
      id, session_date, session_type, category, calendar_block_id, notes, needs_review, created_at,
      strength_sets ( id, set_number, weight, reps, rpe, exercise_id, exercises ( canonical_name, movement_pattern ) ),
      running_sessions ( run_type, distance_m, duration_s, avg_pace_s_per_mi, splits )
    `)
    .eq('user_id', USER_ID)
    .gte('session_date', since.toISOString().slice(0, 10))
    .order('session_date', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ days, sessions: sessions || [] });
}
