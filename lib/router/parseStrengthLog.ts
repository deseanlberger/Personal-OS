import { z } from 'zod';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

const StrengthSetSchema = z.object({
  weight: z.number().min(0),
  reps: z.number().int().positive().max(100),
  rpe: z.number().min(1).max(10).nullable().optional(),
});

const StrengthLogSchema = z.object({
  is_strength_log: z.boolean(),
  exercise_alias: z.string().nullable(),
  sets: z.array(StrengthSetSchema).default([]),
  notes: z.string().nullable().optional(),
});

export type ParsedStrengthSet = z.infer<typeof StrengthSetSchema>;
export type ParsedStrengthLog = z.infer<typeof StrengthLogSchema>;

const PROMPT = `You parse strength training set logs from short voice or text captures.

Inputs come from a strength coach logging his own training. He sends one message
that may or may not be a strength log. Common formats:

- "bench 225 by 5 by 5 by 5" → 3 sets of 5 reps at 225 lbs
- "bench 225x5x5" → 2 sets of 5 reps at 225 lbs
- "bench 5x5 at 225" → 5 sets of 5 reps at 225 lbs
- "OHP 135 for 8" → 1 set of 8 reps at 135 lbs
- "DB bench 80s 4x10 @ 8" → 4 sets of 10 reps at 80, RPE 8
- "close grip bench 185 5/5/5/4" → 4 sets at 185: 5, 5, 5, 4 reps
- "incline db 70 for 12, 10, 8" → 3 sets at 70: 12 reps, 10 reps, 8 reps

If the message is NOT a strength log (a task, a thought, a calendar event, an
errand, a journal entry), set is_strength_log=false and leave fields default.
Bias toward false when the input is ambiguous — false positives are worse than
false negatives because the regular classifier picks up the slack.

If it IS a strength log:
- exercise_alias: the exercise as spoken/typed, lowercase, trimmed of filler
  words. Do NOT normalize to a canonical name; code does that. Examples:
  "bench", "incline db", "ohp", "close grip bench", "cable fly".
- sets: array of {weight, reps, rpe?}. Expand any shorthand into one entry
  per set. Weight is the total external load on the bar/DB (don't double DB
  weight for per-side unless clearly stated).
- notes: any extra context (paused reps, RIR, "felt heavy", form cues).
  Null if nothing extra.

Output VALID JSON ONLY (no markdown, no preamble):
{
  "is_strength_log": true,
  "exercise_alias": "bench",
  "sets": [{"weight": 225, "reps": 5, "rpe": null}, {"weight": 225, "reps": 5, "rpe": null}],
  "notes": null
}`;

function safeJsonParse(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * Detect and parse a strength log from a short capture. Returns null if the
 * message isn't a strength log or the LLM is unavailable. Caller falls through
 * to the regular classifier.
 *
 * Cheap gate first: every real strength log contains at least one number AND
 * at least one letter. Spend a Claude call only past that filter.
 */
export async function parseStrengthLog(text: string): Promise<ParsedStrengthLog | null> {
  if (!claudeAvailable()) return null;
  if (!/\d/.test(text) || !/[a-z]/i.test(text)) return null;

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 500,
      system: PROMPT,
      messages: [{ role: 'user', content: text }],
    });
    const block = msg.content[0];
    if (!block || block.type !== 'text') return null;
    const raw = safeJsonParse(block.text);
    const parsed = StrengthLogSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (!parsed.data.is_strength_log) return null;
    if (parsed.data.sets.length === 0) return null;
    if (!parsed.data.exercise_alias) return null;
    return parsed.data;
  } catch (err) {
    console.error('[parseStrengthLog] failed:', (err as Error).message);
    return null;
  }
}

export type ResolvedExercise = { exercise_id: string; canonical_name: string };

/**
 * Resolve a spoken alias to an exercise row. Returns null when no match —
 * caller surfaces the pending log on the dashboard for the user to create
 * the new exercise OR merge into an existing one.
 */
export async function resolveExercise(alias: string): Promise<ResolvedExercise | null> {
  const normalized = alias.toLowerCase().trim();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('exercises')
    .select('id, canonical_name, aliases')
    .eq('user_id', USER_ID)
    .eq('is_active', true);
  if (error || !data) return null;

  for (const ex of data as { id: string; canonical_name: string; aliases: string[] }[]) {
    if (ex.canonical_name.toLowerCase() === normalized) {
      return { exercise_id: ex.id, canonical_name: ex.canonical_name };
    }
    if (Array.isArray(ex.aliases) && ex.aliases.some((a) => a.toLowerCase() === normalized)) {
      return { exercise_id: ex.id, canonical_name: ex.canonical_name };
    }
  }
  return null;
}
