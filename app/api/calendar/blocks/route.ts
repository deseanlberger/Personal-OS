import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { blockId, mondayOfWeek, type WeekLabel } from '@/lib/blocks/template';
import { blocksForWeekFromDb } from '@/lib/blocks/templateStore';
import { getWeekLabel } from '@/lib/app_meta';
import type { Task } from '@/lib/types';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/calendar/blocks?weekOffset=N&week=A|B
 *   weekOffset: integer (default 0). 0 = current week, 1 = next, -1 = last, etc.
 *               When non-zero, weekLabel auto-flips per A↔B Sunday rotation.
 *   week:       explicit override; takes precedence over the auto-flip.
 *
 * Tasks are only shown as assigned when weekOffset === 0 (assignments live in
 * the current week only — recalc never schedules things for future weeks).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const weekOffset = Math.max(-12, Math.min(12, Number(searchParams.get('weekOffset') || '0')));

  const currentLabel = await getWeekLabel();
  const autoLabel: WeekLabel =
    weekOffset % 2 === 0 ? currentLabel : currentLabel === 'A' ? 'B' : 'A';

  const explicit = searchParams.get('week');
  const weekLabel: WeekLabel = explicit === 'A' || explicit === 'B' ? explicit : autoLabel;

  const blocks = await blocksForWeekFromDb(weekLabel);

  // Compute Monday-of-target-week so the client can label day-of-month correctly
  const baseMonday = mondayOfWeek(new Date());
  const targetMonday = new Date(baseMonday);
  targetMonday.setDate(baseMonday.getDate() + weekOffset * 7);

  // Show current-week assignments (weekOffset 0) and next-week overflow (weekOffset 1).
  // Past or further-future weeks show no assignments.
  const showAssignments = weekOffset === 0 || weekOffset === 1;
  const byBlock = new Map<string, Partial<Task>[]>();

  if (showAssignments) {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id,title,category,energy,estimated_minutes,is_pinned,key,assigned_block_id,assigned_week_offset,momentum_score')
      .eq('user_id', USER_ID)
      .is('completed_at', null)
      .eq('assigned_week_offset', weekOffset)
      .not('assigned_block_id', 'is', null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const t of tasks || []) {
      if (!t.assigned_block_id) continue;
      if (!byBlock.has(t.assigned_block_id)) byBlock.set(t.assigned_block_id, []);
      byBlock.get(t.assigned_block_id)!.push(t);
    }
  }

  const rendered = blocks.map((b) => ({
    id: blockId(b),
    day: b.day,
    start: b.start,
    end: b.end,
    name: b.name,
    type: b.type,
    energy: b.energy ?? null,
    locked: !!b.locked,
    assigned_tasks: byBlock.get(blockId(b)) || [],
  }));

  return NextResponse.json({
    weekLabel,
    weekOffset,
    weekStart: targetMonday.toISOString().slice(0, 10),
    isCurrentWeek: weekOffset === 0,
    blocks: rendered,
  });
}
