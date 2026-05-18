import { supabase } from '@/lib/supabase/server';
import { classifyCapture, type Classification } from '@/lib/router/classifyCapture';
import { embed } from '@/lib/embeddings';
import { recalcWeek } from '@/lib/blocks/recalc';

const USER_ID = process.env.USER_ID || 'desean';

export type CaptureSource = 'telegram' | 'web' | 'ios_shortcut' | 'api';

export type CaptureInput = {
  text: string;
  source: CaptureSource;
  audio_url?: string | null;
};

export type CaptureResult = {
  raw_capture_id: string;
  routed_to: 'tasks' | null;
  routed_id: string | null;
  classification: Classification;
  llm_source: 'claude' | 'openai' | 'regex';
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

  // 1. Classify
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
