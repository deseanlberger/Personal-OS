import { supabase } from '@/lib/supabase/server';
import { classifyCapture, type Classification } from '@/lib/router/classifyCapture';
import { parseStrengthLog, resolveExercise, type ParsedStrengthLog } from '@/lib/router/parseStrengthLog';
import { embed } from '@/lib/embeddings';
import { recalcWeek } from '@/lib/blocks/recalc';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

export type CaptureSource = 'telegram' | 'web' | 'ios_shortcut' | 'api';

export type CaptureInput = {
  text: string;
  source: CaptureSource;
  audio_url?: string | null;
};

export type CaptureResult = {
  raw_capture_id: string;
  routed_to: 'tasks' | 'strength_session' | 'strength_pending' | null;
  routed_id: string | null;
  classification: Classification;
  llm_source: 'claude' | 'openai' | 'regex' | 'strength_parser';
  strength?: {
    exercise_canonical: string | null;
    exercise_alias: string;
    sets: { weight: number; reps: number; rpe: number | null }[];
    needs_review: boolean;
  };
};

/**
 * Full capture pipeline:
 *   1. classify the text
 *   2. write raw_capture row
 *   3. route to downstream table (tasks for kind=task/decision)
 *   4. write memory_chunk with embedding
 *   5. write audit_log row
 *
 * Each step is best-effort — a failure in embeddings doesn't block the capture itself.
 */
export async function routeCapture(input: CaptureInput): Promise<CaptureResult> {
  const { text, source, audio_url = null } = input;

  // 1a. Strength log short-circuit. If the message parses as a strength log
  // (one Claude call gated by a cheap regex), route it to workout_sessions
  // + strength_sets and skip the general classifier entirely.
  const strengthLog = await parseStrengthLog(text);
  if (strengthLog) {
    return await routeStrengthLog(text, source, audio_url, strengthLog);
  }

  // 1b. Otherwise classify as normal
  const { classification, llm_source } = await classifyCapture(text);

  // 2. Write raw_capture (this MUST succeed)
  const { data: rawCapture, error: rawErr } = await supabase
    .from('raw_captures')
    .insert({
      user_id: USER_ID,
      source,
      raw_text: text,
      audio_url,
      classification: classification as unknown as Record<string, unknown>,
      llm_source,
    })
    .select('id')
    .single();

  if (rawErr || !rawCapture) {
    throw new Error(`raw_captures insert failed: ${rawErr?.message}`);
  }
  const rawCaptureId = rawCapture.id;

  // 3. Route to downstream table
  let routed_to: CaptureResult['routed_to'] = null;
  let routed_id: string | null = null;

  if (classification.kind === 'task' || classification.kind === 'decision') {
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .insert({
        user_id: USER_ID,
        title: classification.summary,
        urgency: classification.urgency,
        key: classification.kind === 'decision',
        category: classification.category,
        energy: classification.energy,
        estimated_minutes: classification.estimated_minutes,
        tags: classification.tags,
      })
      .select('id')
      .single();

    if (!taskErr && task) {
      routed_to = 'tasks';
      routed_id = task.id;
      // Update raw_capture with the routing info
      await supabase
        .from('raw_captures')
        .update({ routed_to, routed_id })
        .eq('id', rawCaptureId);
    } else {
      console.error('[routeCapture] task insert failed:', taskErr?.message);
    }
  }

  // 4. Embed + write memory_chunk (best-effort)
  try {
    const vec = await embed(`${classification.summary}\n\n${text}`);
    if (vec) {
      const sourceType = classification.kind === 'task' || classification.kind === 'decision' ? 'task' : 'capture';
      const sourceId = routed_id || rawCaptureId;
      await supabase.from('memory_chunks').insert({
        user_id: USER_ID,
        source_type: sourceType,
        source_id: sourceId,
        text: classification.summary,
        embedding: vec as unknown as string,
      });
    }
  } catch (err) {
    console.error('[routeCapture] embedding/memory write failed:', (err as Error).message);
  }

  // 5. Audit
  await supabase.from('audit_log').insert({
    user_id: USER_ID,
    action: 'capture.create',
    resource_type: routed_to || 'raw_captures',
    resource_id: routed_id || rawCaptureId,
    metadata: { source, llm_source, kind: classification.kind },
  });

  // 6. Auto-recalc blocks when a new slottable task lands. Fire-and-forget
  // so the API response isn't blocked on it; failures are logged not thrown.
  if (routed_to === 'tasks' && classification.category && classification.category !== 'meeting' && classification.category !== 'personal') {
    recalcWeek().catch((err) => {
      console.error('[routeCapture] auto-recalc failed:', err.message);
    });
  }

  return { raw_capture_id: rawCaptureId, routed_to, routed_id, classification, llm_source };
}

/**
 * Strength log routing branch. Called from routeCapture when the strength
 * parser recognizes a set log. Always writes a raw_capture row first so the
 * audit trail and embeddings stay consistent with the regular path. Then:
 *   • If the alias resolves to an existing exercise — insert workout_session
 *     + strength_sets and return routed_to='strength_session'.
 *   • If the alias does NOT resolve — leave the raw_capture flagged with the
 *     parsed payload and return routed_to='strength_pending' so the dashboard
 *     can prompt the user to create the exercise / merge into an existing one.
 */
async function routeStrengthLog(
  text: string,
  source: CaptureSource,
  audio_url: string | null,
  log: ParsedStrengthLog,
): Promise<CaptureResult> {
  const aliasRaw = (log.exercise_alias || '').trim();
  const exercise = await resolveExercise(aliasRaw);

  // Synthesize a Classification so the public type stays consistent. category
  // and energy mirror what workout blocks use today.
  const summary = exercise
    ? `${exercise.canonical_name}: ${formatSetSummary(log.sets)}`
    : `Pending strength log: ${aliasRaw} ${formatSetSummary(log.sets)}`;
  const classification: Classification = {
    kind: 'capture',
    urgency: 'today',
    category: 'personal',
    energy: null,
    estimated_minutes: null,
    tags: ['workout', 'strength'],
    summary,
    confidence: exercise ? 0.95 : 0.5,
  };

  // 1. Write raw_capture with the parsed payload embedded in classification
  const { data: rawCapture, error: rawErr } = await supabase
    .from('raw_captures')
    .insert({
      user_id: USER_ID,
      source,
      raw_text: text,
      audio_url,
      classification: {
        ...(classification as unknown as Record<string, unknown>),
        strength_log: log as unknown as Record<string, unknown>,
        resolved_exercise_id: exercise?.exercise_id ?? null,
      },
      llm_source: 'strength_parser',
    })
    .select('id')
    .single();
  if (rawErr || !rawCapture) {
    throw new Error(`raw_captures insert failed: ${rawErr?.message}`);
  }
  const rawCaptureId = rawCapture.id;

  // 2. If we can't resolve the exercise, leave it pending and return.
  if (!exercise) {
    await supabase.from('audit_log').insert({
      user_id: USER_ID,
      action: 'capture.create',
      resource_type: 'raw_captures',
      resource_id: rawCaptureId,
      metadata: { source, llm_source: 'strength_parser', kind: 'strength_pending', alias: aliasRaw },
    });
    return {
      raw_capture_id: rawCaptureId,
      routed_to: 'strength_pending',
      routed_id: null,
      classification,
      llm_source: 'strength_parser',
      strength: {
        exercise_canonical: null,
        exercise_alias: aliasRaw,
        sets: log.sets.map((s) => ({ weight: s.weight, reps: s.reps, rpe: s.rpe ?? null })),
        needs_review: true,
      },
    };
  }

  // 3. Create workout_session + strength_sets
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
  if (sessionErr || !session) {
    throw new Error(`workout_sessions insert failed: ${sessionErr?.message}`);
  }

  const setRows = log.sets.map((s, i) => ({
    session_id: session.id,
    exercise_id: exercise.exercise_id,
    set_number: i + 1,
    weight: s.weight,
    reps: s.reps,
    rpe: s.rpe ?? null,
  }));
  const { error: setsErr } = await supabase.from('strength_sets').insert(setRows);
  if (setsErr) {
    throw new Error(`strength_sets insert failed: ${setsErr.message}`);
  }

  await supabase.from('raw_captures').update({
    routed_to: 'workout_sessions',
    routed_id: session.id,
  }).eq('id', rawCaptureId);

  // 4. Best-effort embedding so the session shows up in /brain search
  try {
    const vec = await embed(summary);
    if (vec) {
      await supabase.from('memory_chunks').insert({
        user_id: USER_ID,
        source_type: 'workout_session',
        source_id: session.id,
        text: summary,
        embedding: vec as unknown as string,
      });
    }
  } catch (err) {
    console.error('[routeStrengthLog] embed failed:', (err as Error).message);
  }

  // 5. Audit
  await supabase.from('audit_log').insert({
    user_id: USER_ID,
    action: 'capture.create',
    resource_type: 'workout_sessions',
    resource_id: session.id,
    metadata: { source, llm_source: 'strength_parser', kind: 'strength_session', exercise: exercise.canonical_name, set_count: setRows.length },
  });

  return {
    raw_capture_id: rawCaptureId,
    routed_to: 'strength_session',
    routed_id: session.id,
    classification,
    llm_source: 'strength_parser',
    strength: {
      exercise_canonical: exercise.canonical_name,
      exercise_alias: aliasRaw,
      sets: log.sets.map((s) => ({ weight: s.weight, reps: s.reps, rpe: s.rpe ?? null })),
      needs_review: false,
    },
  };
}

function formatSetSummary(sets: ParsedStrengthLog['sets']): string {
  if (sets.length === 0) return '';
  // Compress identical sets: "225x5x3" if 3 sets of 5 at 225
  const allSame = sets.every((s) => s.weight === sets[0].weight && s.reps === sets[0].reps);
  if (allSame) {
    return `${sets[0].weight}×${sets[0].reps}×${sets.length}`;
  }
  return sets.map((s) => `${s.weight}×${s.reps}`).join(', ');
}
