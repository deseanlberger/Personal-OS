import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { classifyCapture } from '@/lib/router/classifyCapture';
import { recalcWeek } from '@/lib/blocks/recalc';

const USER_ID = process.env.USER_ID || 'desean';
const DEFAULT_LIMIT = 100;

/**
 * POST /api/tasks/backfill-categories  { limit?: number, dry_run?: boolean }
 * Finds open tasks where category is null and runs each through the
 * classifier to fill in category/energy/estimated_minutes. Sequential
 * to keep LLM rate-limits sane; returns a per-task summary.
 *
 * Triggers a single recalc at the end so all newly-categorized tasks
 * land in matching blocks in one pass.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { limit?: number; dry_run?: boolean };
  const limit = Math.min(Math.max(Number(body.limit || DEFAULT_LIMIT), 1), 500);
  const dryRun = !!body.dry_run;

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, category, energy, estimated_minutes')
    .eq('user_id', USER_ID)
    .is('completed_at', null)
    .is('category', null)
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ ok: true, classified: 0, updated: 0, items: [] });
  }

  type Item = {
    id: string;
    title: string;
    category: string | null;
    energy: string | null;
    estimated_minutes: number | null;
    error?: string;
  };
  const items: Item[] = [];
  let updated = 0;

  for (const t of tasks) {
    try {
      const { classification } = await classifyCapture(t.title);
      const item: Item = {
        id: t.id,
        title: t.title,
        category: classification.category,
        energy: classification.energy,
        estimated_minutes: classification.estimated_minutes,
      };
      items.push(item);
      if (!dryRun && classification.category) {
        const { error: upErr } = await supabase
          .from('tasks')
          .update({
            category: classification.category,
            energy: t.energy ?? classification.energy,
            estimated_minutes: t.estimated_minutes ?? classification.estimated_minutes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', t.id);
        if (upErr) {
          item.error = upErr.message;
        } else {
          updated++;
        }
      }
    } catch (err) {
      items.push({
        id: t.id,
        title: t.title,
        category: null,
        energy: null,
        estimated_minutes: null,
        error: (err as Error).message,
      });
    }
  }

  if (!dryRun && updated > 0) {
    try {
      await recalcWeek();
    } catch (err) {
      console.error('[backfill-categories] recalc failed:', (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true, classified: items.length, updated, dry_run: dryRun, items });
}
