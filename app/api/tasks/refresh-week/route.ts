import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { classifyCapture } from '@/lib/router/classifyCapture';
import { recalcWeek } from '@/lib/blocks/recalc';

const USER_ID = process.env.USER_ID || 'desean';
const BACKFILL_CAP = 200;

/**
 * POST /api/tasks/refresh-week
 * "Set up my week from scratch" — one-button reset for the task board:
 *   1. Classify every open task that's missing a category (so nothing
 *      sits invisible to the block engine).
 *   2. Run recalcWeek() to clear all current assignments and place
 *      tasks into matching blocks fresh.
 * Returns a compact summary so the UI can show "37 tasks classified,
 * 24 assigned, 3 skipped" toast.
 */
export async function POST() {
  // 1. Catch any uncategorized open tasks.
  const { data: uncategorized, error } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('user_id', USER_ID)
    .is('completed_at', null)
    .is('category', null)
    .limit(BACKFILL_CAP);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let classified = 0;
  const classifyErrors: string[] = [];
  for (const t of uncategorized || []) {
    try {
      const { classification } = await classifyCapture(t.title);
      if (!classification.category) continue;
      const { error: upErr } = await supabase
        .from('tasks')
        .update({
          category: classification.category,
          energy: classification.energy,
          estimated_minutes: classification.estimated_minutes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', t.id);
      if (upErr) {
        classifyErrors.push(`${t.id.slice(0, 8)}: ${upErr.message}`);
      } else {
        classified++;
      }
    } catch (err) {
      classifyErrors.push(`${t.id.slice(0, 8)}: ${(err as Error).message}`);
    }
  }

  // 2. Recalc the week from scratch.
  try {
    const result = await recalcWeek();
    return NextResponse.json({
      ok: true,
      classified,
      assigned: result.assignedCount,
      skipped: result.skippedCount,
      total_open: result.totalOpenTasks,
      one_thing: result.oneThing,
      week_label: result.weekLabel,
      classify_errors: classifyErrors.length ? classifyErrors : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, classified, partial: true },
      { status: 500 },
    );
  }
}
