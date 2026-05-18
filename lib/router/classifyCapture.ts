import { z } from 'zod';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { openaiClient, openaiClassifierModel, openaiAvailable } from '@/lib/llm/openai';

export const ClassificationSchema = z.object({
  kind: z.enum(['task', 'note', 'decision', 'journal', 'capture']),
  urgency: z.enum(['today', 'this_week', 'this_month', 'someday']),
  category: z.enum(['deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'personal', 'flex']).nullable(),
  energy: z.enum(['high', 'med', 'low']).nullable(),
  estimated_minutes: z.number().int().positive().nullable(),
  tags: z.array(z.string()).max(5),
  summary: z.string().min(1).max(140),
});

export type Classification = z.infer<typeof ClassificationSchema>;
export type ClassifyResult = { classification: Classification; llm_source: 'claude' | 'openai' | 'regex' };

const SYSTEM_PROMPT = `You classify personal-OS captures into structured JSON for Desean Berger, head coach at Odyssey Performance in Vista, CA.

His weekly schedule blocks are:
- deep-thinking (HIGH energy): strategic, creative, planning work — programming, writing essays, designing systems
- deep-admin (MED energy): focused execution — paperwork, contracts, finance ops, careful single-task work
- multitask-admin (LOW energy): email, slack, light scheduling, calls while doing other things
- meeting: scheduled with another person
- personal: workouts, transit, meals, sleep, errands — anything NOT work
- flex: weekend ops cleanup that could be deep-thinking OR deep-admin

Output JSON ONLY (no markdown, no preamble) matching this shape:
{
  "kind": "task" | "note" | "decision" | "journal" | "capture",
  "urgency": "today" | "this_week" | "this_month" | "someday",
  "category": "deep-thinking" | "deep-admin" | "multitask-admin" | "meeting" | "personal" | "flex" | null,
  "energy": "high" | "med" | "low" | null,
  "estimated_minutes": <int 5-240> | null,
  "tags": ["short", "kebab-case"],
  "summary": "short imperative title under 80 chars"
}

Rules:
- kind=task if it's an action Desean needs to do; kind=journal if it's a thought/reflection; kind=decision if it's a choice he's locking in; kind=note if it's a fact to remember; kind=capture for everything else.
- Infer urgency from cues: "today/morning/now" → today; "this week/Friday/by EOW" → this_week; "this month/later" → this_month; otherwise → someday.
- category + energy must match (deep-thinking=high, deep-admin=med, multitask-admin=low, meeting/personal=null, flex=null).
- For kind=task without clear category, default to deep-admin/med.
- For kind=journal/note/capture, set category=null and energy=null.
- estimated_minutes: realistic guess (15 for quick admin, 60-90 for deep work, 30 for meetings).
- tags: 0-3 short kebab-case tags (e.g. "athlete-marcus", "p360", "sales-meeting"). Empty array if nothing obvious.
- summary: rewrite the input as a clean imperative if it's a task ("Call Phly about insurance" not "i need to call phly"), or a clean noun phrase otherwise.`;

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function classifyWithClaude(text: string): Promise<Classification | null> {
  if (!claudeAvailable()) return null;
  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });
    const block = msg.content[0];
    if (!block || block.type !== 'text') return null;
    const parsed = safeJsonParse(block.text);
    return ClassificationSchema.parse(parsed);
  } catch (err) {
    console.error('[classifyCapture] Claude failed:', (err as Error).message);
    return null;
  }
}

async function classifyWithOpenAI(text: string): Promise<Classification | null> {
  if (!openaiAvailable()) return null;
  try {
    const res = await openaiClient().chat.completions.create({
      model: openaiClassifierModel(),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = safeJsonParse(content);
    return ClassificationSchema.parse(parsed);
  } catch (err) {
    console.error('[classifyCapture] OpenAI failed:', (err as Error).message);
    return null;
  }
}

function classifyWithRegex(text: string): Classification {
  const lower = text.toLowerCase();
  const urgency: Classification['urgency'] = /today|now|tonight|this morning/.test(lower)
    ? 'today'
    : /tomorrow|this week|friday|by eow/.test(lower)
      ? 'this_week'
      : /this month|next week/.test(lower)
        ? 'this_month'
        : 'someday';
  const isTask = /^(call|email|text|ship|send|write|do|finish|review|fix|build|book|schedule|order|buy|pay)\b/i.test(text);
  return {
    kind: isTask ? 'task' : 'capture',
    urgency,
    category: isTask ? 'deep-admin' : null,
    energy: isTask ? 'med' : null,
    estimated_minutes: isTask ? 15 : null,
    tags: [],
    summary: text.length > 80 ? text.slice(0, 77) + '...' : text,
  };
}

export async function classifyCapture(text: string): Promise<ClassifyResult> {
  const claude = await classifyWithClaude(text);
  if (claude) return { classification: claude, llm_source: 'claude' };

  const openai = await classifyWithOpenAI(text);
  if (openai) return { classification: openai, llm_source: 'openai' };

  return { classification: classifyWithRegex(text), llm_source: 'regex' };
}
