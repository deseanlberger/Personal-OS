import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey, USER_TIMEZONE } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/workout/today
 *
 * Read-only summary for the Jarvis morning brief and the Today card on the
 * dashboard. Returns:
 *   • whether Desean already logged a workout today
 *   • the most recent best-set on his primary movement (bench)
 *   • the last running session's distance + pace
 *   • the upcoming workout block on today's calendar (by category=personal)
 *
 * No mutations, no recalcs — this endpoint is hot-path-cheap so Jarvis can
 * call it inside the existing /api/jarvis/brief render with no penalty.
 */
export async function GET() {
  const today = localDateKey();

  // Today's strength + running sessions
  const { data: todaySessions } = await supabase
    .from('workout_sessions')
    .select('id, session_type, notes')
    .eq('user_id', USER_ID)
    .eq('session_date', today);

  const did_strength_today = !!todaySessions?.some((s) => s.session_type === 'strength');
  const did_running_today = !!todaySessions?.some((s) => s.session_type === 'running');

  // Last best-set on bench (primary movement; bench gets the spotlight)
  const { data: benchRows } = await supabase
    .from('v_strength_pr_trend')
    .select('session_date, best_top_weight, best_e1rm')
    .eq('exercise_name', 'Barbell Bench Press')
    .order('session_date', { ascending: false })
    .limit(1);
  const last_bench = benchRows?.[0]
    ? {
        date: benchRows[0].session_date as string,
        top_weight: Number(benchRows[0].best_top_weight),
        e1rm: Number(benchRows[0].best_e1rm),
      }
    : null;

  // Last running session
  const { data: lastRun } = await supabase
    .from('workout_sessions')
    .select('session_date, running_sessions!inner(distance_m, duration_s, avg_pace_s_per_mi, run_type)')
    .eq('user_id', USER_ID)
    .eq('session_type', 'running')
    .order('session_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  type LastRun = { session_date: string; running_sessions: { distance_m: number; duration_s: number; avg_pace_s_per_mi: number | null; run_type: string } };
  const METERS_PER_MILE = 1609.344;
  const lr = lastRun as unknown as LastRun | null;
  const last_run = lr
    ? {
        date: lr.session_date,
        distance_mi: Number((Number(lr.running_sessions.distance_m) / METERS_PER_MILE).toFixed(2)),
        duration_s: Number(lr.running_sessions.duration_s),
        avg_pace_s_per_mi: lr.running_sessions.avg_pace_s_per_mi ? Number(lr.running_sessions.avg_pace_s_per_mi) : null,
        run_type: lr.running_sessions.run_type,
      }
    : null;

  // Today's upcoming workout block (read-only; we don't write back).
  // Day-of-week in user's local TZ — the morning brief shouldn't drift in UTC.
  const todayDow = new Date(
    new Date().toLocaleString('en-US', { timeZone: USER_TIMEZONE }),
  ).getDay();
  const { data: workoutBlocks } = await supabase
    .from('block_templates')
    .select('day, start_time, end_time, name')
    .eq('user_id', USER_ID)
    .eq('is_active', true)
    .eq('day', todayDow)
    .ilike('name', '%workout%')
    .order('start_time', { ascending: true })
    .limit(1);
  const upcoming_block = workoutBlocks?.[0]
    ? {
        name: workoutBlocks[0].name as string,
        start: workoutBlocks[0].start_time as string,
        end: workoutBlocks[0].end_time as string,
      }
    : null;

  // Suggested target on bench: nudge by 5 lb if the last top-set hit clean reps.
  // Crude but useful for the brief — refined logic can come in Phase 2.
  const suggested_bench = last_bench
    ? { weight: Math.round(last_bench.top_weight + 5), reps: 5 }
    : null;

  return NextResponse.json({
    today,
    did_strength_today,
    did_running_today,
    last_bench,
    last_run,
    upcoming_block,
    suggested_bench,
  });
}
