import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { blockId, mondayOfWeek, type WeekLabel } from '@/lib/blocks/template';
import { blocksForWeekFromDb } from '@/lib/blocks/templateStore';
import { getWeekLabel } from '@/lib/app_meta';
import type { Task } from '@/lib/types';

const USER_ID = process.env.USER_ID || 'desean';

function parseHHMMtoMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

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

  // Fetch this week's overrides BEFORE rendering so we can slice conflicting
  // template blocks out of the way.
  const weekEnd = new Date(targetMonday);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekStartIso = targetMonday.toISOString().slice(0, 10);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  const { data: overrides } = await supabase
    .from('block_overrides')
    .select('id, override_date, start_time, end_time, name, type, energy, locked')
    .eq('user_id', USER_ID)
    .gte('override_date', weekStartIso)
    .lte('override_date', weekEndIso);

  // Index overrides by day-of-week
  type OverrideTime = { startMin: number; endMin: number };
  const overridesByDay = new Map<number, OverrideTime[]>();
  for (const ov of overrides || []) {
    const d = new Date(ov.override_date + 'T00:00:00');
    const day = d.getDay();
    const startMin = parseHHMMtoMin(ov.start_time);
    const endMin = parseHHMMtoMin(ov.end_time);
    if (!overridesByDay.has(day)) overridesByDay.set(day, []);
    overridesByDay.get(day)!.push({ startMin, endMin });
  }

  function applyOverrides(blockDay: number, blockStart: string, blockEnd: string): { start: string; end: string } | null {
    let startMin = parseHHMMtoMin(blockStart);
    let endMin = parseHHMMtoMin(blockEnd);
    const dayOverrides = overridesByDay.get(blockDay) || [];
    for (const ov of dayOverrides) {
      // No overlap
      if (ov.endMin <= startMin || ov.startMin >= endMin) continue;
      // Override fully covers this block → drop it
      if (ov.startMin <= startMin && ov.endMin >= endMin) return null;
      // Override starts before, ends inside → trim start of block
      if (ov.startMin <= startMin && ov.endMin > startMin) {
        startMin = ov.endMin;
        continue;
      }
      // Override starts inside, ends after → trim end of block
      if (ov.startMin < endMin && ov.endMin >= endMin) {
        endMin = ov.startMin;
        continue;
      }
      // Override sits fully inside the block → keep the larger remaining half
      const leftSize = ov.startMin - startMin;
      const rightSize = endMin - ov.endMin;
      if (leftSize >= rightSize) endMin = ov.startMin;
      else startMin = ov.endMin;
    }
    if (endMin - startMin < 5) return null;
    return { start: minToHHMM(startMin), end: minToHHMM(endMin) };
  }

  type RenderedBlock = {
    id: string;
    day: number;
    start: string;
    end: string;
    name: string;
    type: string;
    energy: string | null;
    locked: boolean;
    is_override: boolean;
    override_id: string | null;
    assigned_tasks: Partial<Task>[];
  };

  const rendered: RenderedBlock[] = [];
  for (const b of blocks) {
    const sliced = applyOverrides(b.day, b.start, b.end);
    if (!sliced) continue; // template block fully covered by an override
    rendered.push({
      id: blockId(b), // keep original ID so assigned tasks still match
      day: b.day,
      start: sliced.start,
      end: sliced.end,
      name: b.name,
      type: b.type,
      energy: b.energy ?? null,
      locked: !!b.locked,
      is_override: false,
      override_id: null,
      assigned_tasks: byBlock.get(blockId(b)) || [],
    });
  }

  // Now layer in the override blocks themselves
  for (const ov of overrides || []) {
    const d = new Date(ov.override_date + 'T00:00:00');
    rendered.push({
      id: `OVR-${ov.id}`,
      day: d.getDay(),
      start: ov.start_time,
      end: ov.end_time,
      name: ov.name,
      type: ov.type,
      energy: ov.energy ?? null,
      locked: !!ov.locked,
      is_override: true,
      override_id: ov.id,
      assigned_tasks: [],
    });
  }
  const renderedFinal = rendered;

  return NextResponse.json({
    weekLabel,
    weekOffset,
    weekStart: targetMonday.toISOString().slice(0, 10),
    isCurrentWeek: weekOffset === 0,
    blocks: renderedFinal,
  });
}
