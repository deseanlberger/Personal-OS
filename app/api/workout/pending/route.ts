import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

type StrengthLogPayload = {
  is_strength_log: boolean;
  exercise_alias: string;
  sets: { weight: number; reps: number; rpe: number | null }[];
  notes?: string | null;
};

type RawCaptureRow = {
  id: string;
  raw_text: string;
  created_at: string;
  classification: {
    strength_log?: StrengthLogPayload;
    resolved_exercise_id?: string | null;
  } | null;
};

/**
 * GET /api/workout/pending — raw_captures that parsed as strength logs but
 * couldn't resolve to an existing exercise. Powers the merge/create UI.
 */
export async function GET() {
  const { data, error } = await supabase
    .from('raw_captures')
    .select('id, raw_text, created_at, classification')
    .eq('user_id', USER_ID)
    .eq('llm_source', 'strength_parser')
    .is('routed_to', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = ((data || []) as RawCaptureRow[])
    .filter((r) => r.classification?.strength_log?.is_strength_log)
    .map((r) => ({
      raw_capture_id: r.id,
      raw_text: r.raw_text,
      created_at: r.created_at,
      alias: r.classification!.strength_log!.exercise_alias,
      sets: r.classification!.strength_log!.sets,
      notes: r.classification!.strength_log!.notes ?? null,
    }));
  return NextResponse.json({ items });
}

/**
 * POST /api/workout/pending/resolve
 * Body: {
 *   raw_capture_id: string,
 *   action: 'merge' | 'create',
 *   exercise_id?: string,                  // when action='merge'
 *   new_exercise?: {                       // when action='create'
 *     canonical_name: string,
 *     movement_pattern: string,
 *     muscle_group: string,
 *     aliases?: string[]
 *   }
 * }
 *
 * After resolving, the parsed strength_log payload is finalized: workout_session
 * + strength_sets rows are inserted and the raw_capture is updated to point at
 * the new session.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.raw_capture_id) {
    return NextResponse.json({ error: 'raw_capture_id required' }, { status: 400 });
  }

  // Load the pending raw_capture
  const { data: rawRow, error: rawErr } = await supabase
    .from('raw_captures')
    .select('id, classification, source, raw_text')
    .eq('id', body.raw_capture_id)
    .eq('user_id', USER_ID)
    .single();
  if (rawErr || !rawRow) return NextResponse.json({ error: 'pending capture not found' }, { status: 404 });

  const cls = rawRow.classification as { strength_log?: StrengthLogPayload } | null;
  const log = cls?.strength_log;
  if (!log?.is_strength_log || !log.sets?.length) {
    return NextResponse.json({ error: 'no strength_log payload on this capture' }, { status: 400 });
  }

  // Resolve exercise_id
  let exerciseId: string | null = null;
  let exerciseName: string | null = null;
  if (body.action === 'merge') {
    if (typeof body.exercise_id !== 'string') {
      return NextResponse.json({ error: 'exercise_id required for merge' }, { status: 400 });
    }
    const { data: ex } = await supabase
      .from('exercises')
      .select('id, canonical_name, aliases')
      .eq('id', body.exercise_id)
      .eq('user_id', USER_ID)
      .maybeSingle();
    if (!ex) return NextResponse.json({ error: 'target exercise not found' }, { status: 404 });
    exerciseId = ex.id;
    exerciseName = ex.canonical_name;
    // Add the unrecognized alias so future logs resolve straight through
    const aliasNorm = (log.exercise_alias || '').toLowerCase().trim();
    if (aliasNorm && Array.isArray(ex.aliases) && !ex.aliases.map((a: string) => a.toLowerCase()).includes(aliasNorm)) {
      await supabase
        .from('exercises')
        .update({ aliases: [...ex.aliases, aliasNorm] })
        .eq('id', ex.id);
    }
  } else if (body.action === 'create') {
    const ne = body.new_exercise;
    if (!ne?.canonical_name || !ne?.movement_pattern || !ne?.muscle_group) {
      return NextResponse.json({ error: 'new_exercise.{canonical_name, movement_pattern, muscle_group} required' }, { status: 400 });
    }
    const { data: created, error: createErr } = await supabase
      .from('exercises')
      .insert({
        user_id: USER_ID,
        canonical_name: ne.canonical_name,
        movement_pattern: ne.movement_pattern,
        muscle_group: ne.muscle_group,
        aliases: Array.isArray(ne.aliases) ? ne.aliases : [log.exercise_alias],
      })
      .select('id, canonical_name')
      .single();
    if (createErr || !created) return NextResponse.json({ error: createErr?.message || 'create failed' }, { status: 500 });
    exerciseId = created.id;
    exerciseName = created.canonical_name;
  } else {
    return NextResponse.json({ error: "action must be 'merge' or 'create'" }, { status: 400 });
  }

  // Insert session + sets
  const today = localDateKey();
  const { data: session, error: sessionErr } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: USER_ID,
      session_date: today,
      session_type: 'strength',
      category: 'personal',
      notes: log.notes ?? null,
      needs_review: false,
    })
    .select('id')
    .single();
  if (sessionErr || !session) return NextResponse.json({ error: sessionErr?.message }, { status: 500 });

  const rows = log.sets.map((s, i) => ({
    session_id: session.id,
    exercise_id: exerciseId!,
    set_number: i + 1,
    weight: s.weight,
    reps: s.reps,
    rpe: s.rpe ?? null,
  }));
  const { error: setsErr } = await supabase.from('strength_sets').insert(rows);
  if (setsErr) {
    await supabase.from('workout_sessions').delete().eq('id', session.id);
    return NextResponse.json({ error: setsErr.message }, { status: 500 });
  }

  // Mark the raw_capture as routed
  await supabase
    .from('raw_captures')
    .update({ routed_to: 'workout_sessions', routed_id: session.id })
    .eq('id', body.raw_capture_id);

  return NextResponse.json({ ok: true, session_id: session.id, exercise: exerciseName });
}
