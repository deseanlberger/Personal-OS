import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase/server';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';

const USER_ID = process.env.USER_ID || 'desean';

const ResultSchema = z.object({
  task_ids: z.array(z.string().uuid()).max(20),
  rationale: z.string().max(140),
});

/**
 * POST /api/tasks/smart  { query: string }
 * Returns up to 20 task IDs matching the natural-language query,
 * ranked by Claude's judgment. Falls back to a no-op if Claude unavailable.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.query || typeof body.query !== 'string') {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }
  const query = body.query.trim().slice(0, 300);

  // Pull all open tasks (small dataset — sub-second to load all)
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id,title,urgency,category,energy,estimated_minutes,key,is_pinned,tags,due_date,description')
    .eq('user_id', USER_ID)
    .is('completed_at', null)
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ task_ids: [], rationale: 'No open tasks.' });
  }

  if (!claudeAvailable()) {
    // No LLM: fall back to a substring match.
    const q = query.toLowerCase();
    const matches = tasks
      .filter((t) => t.title.toLowerCase().includes(q) || (t.tags || []).some((tag: string) => tag.toLowerCase().includes(q)))
      .slice(0, 20)
      .map((t) => t.id);
    return NextResponse.json({ task_ids: matches, rationale: 'Substring match (Claude unavailable)' });
  }

  const tasksForPrompt = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    urgency: t.urgency,
    category: t.category,
    energy: t.energy,
    minutes: t.estimated_minutes,
    key: t.key,
    pinned: t.is_pinned,
    tags: t.tags,
    due: t.due_date,
  }));

  const systemPrompt = `You filter and rank tasks for Desean Berger, head coach at Odyssey Performance.

Input: a natural-language query + an array of open tasks (with id, title, urgency, category, energy, minutes, key, tags, due).
Output JSON ONLY:
{
  "task_ids": ["uuid", ...],  // up to 20 matches, most relevant first
  "rationale": "short one-line explanation under 140 chars"
}

Match rules:
- "what should I do this morning" → high-energy/deep-thinking tasks ranked first, then deep-admin
- "quick wins" → low estimated_minutes, multitask-admin or deep-admin
- "athlete X" or person name → match against tags + title
- "deep work" → category=deep-thinking, ranked by key+pinned
- Otherwise: semantic match against titles + tags
- Empty array if nothing relevant.`;

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 600,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Query: ${query}\n\nTasks:\n${JSON.stringify(tasksForPrompt)}` },
      ],
    });
    const block = msg.content[0];
    if (!block || block.type !== 'text') {
      return NextResponse.json({ task_ids: [], rationale: 'No response' });
    }
    const start = block.text.indexOf('{');
    const end = block.text.lastIndexOf('}');
    if (start < 0 || end < 0) {
      return NextResponse.json({ task_ids: [], rationale: 'Parse failed' });
    }
    const parsed = JSON.parse(block.text.slice(start, end + 1));
    const result = ResultSchema.parse(parsed);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/tasks/smart] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
