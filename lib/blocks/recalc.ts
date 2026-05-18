import { supabase } from '@/lib/supabase/server';
import { blockId, blockDates, blockMinutes, mondayOfWeek, type BlockTemplate, type WeekLabel } from './template';
import { blocksForWeekFromDb } from './templateStore';
import { computeMomentum } from './momentum';
import { getWeekLabel } from '@/lib/app_meta';
import type { Task } from '@/lib/types';

const USER_ID = process.env.USER_ID || 'desean';

// Locked block types can't host tasks; flex blocks accept either deep-thinking or deep-admin.
const LOCKED_TYPES = new Set(['coaching', 'personal']);
const TASK_HARD_CAP_MIN = 45;
const REMAINDER_MIN = 15;

export type RecalcResult = {
  weekLabel: WeekLabel;
  totalOpenTasks: number;
  assignedCount: number;
  skippedCount: number;
  oneThing: { taskId: string; title: string; blockId: string } | null;
  assignments: { taskId: string; title: string; blockId: string; minutes: number }[];
  skipped: { taskId: string; title: string; reason: string }[];
};

/**
 * Reassign all open tasks to blocks for the current week.
 *
 * Strategy (ported from command-center):
 *   1. Pull all open tasks (completed_at IS NULL).
 *   2. Sort by momentum score, descending.
 *   3. For each task, find the earliest block whose type matches task.category
 *      (or is flex AND task.category is deep-thinking/deep-admin).
 *   4. "Assign" by setting tasks.assigned_block_id = blockId.
 *      Block capacity = blockMinutes(b), capped at TASK_HARD_CAP_MIN per task.
 *   5. Multiple tasks can share a block if remaining minutes >= REMAINDER_MIN.
 *   6. ⭐ "One Thing": highest-momentum task in a HIGH-energy block gets is_pinned=true.
 *
 * Skips meeting/personal/coaching blocks entirely (locked).
 */
export async function recalcWeek(label?: WeekLabel): Promise<RecalcResult> {
  const weekLabel = label || (await getWeekLabel());
  const allBlocks = await blocksForWeekFromDb(weekLabel);

  // Skip blocks whose start time has already passed — tasks should only be
  // scheduled into UPCOMING blocks, not past ones (otherwise they sit invisible
  // on a past day of the current week).
  const now = new Date();
  const weekStart = mondayOfWeek(now);
  const blocks = allBlocks.filter((b) => {
    const { start } = blockDates(b, weekStart);
    return start.getTime() > now.getTime();
  });

  // 1. Pull open tasks
  const { data: openTasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', USER_ID)
    .is('completed_at', null);
  if (error) throw new Error(`recalcWeek: tasks fetch failed: ${error.message}`);

  // 2. Sort by momentum desc
  const tasks = (openTasks || []) as Task[];
  tasks.sort((a, b) => computeMomentum(b) - computeMomentum(a));

  // 3. Build per-block remaining-minutes map for task-eligible blocks
  type BlockSlot = { block: BlockTemplate; id: string; remainingMin: number };
  const slots: BlockSlot[] = blocks
    .filter((b) => !LOCKED_TYPES.has(b.type) && !b.locked)
    .map((b) => ({ block: b, id: blockId(b), remainingMin: blockMinutes(b) }));

  // Index slots by usable type (a flex slot is usable for deep-thinking AND deep-admin)
  function slotMatches(slot: BlockSlot, taskCategory: string | null): boolean {
    if (!taskCategory) return false;
    if (slot.block.type === 'flex') return taskCategory === 'deep-thinking' || taskCategory === 'deep-admin';
    return slot.block.type === taskCategory;
  }

  // 4. Greedy assignment + clear all previous assignments first
  const clearIds = tasks.map((t) => t.id);
  if (clearIds.length > 0) {
    await supabase
      .from('tasks')
      .update({ assigned_block_id: null })
      .in('id', clearIds);
  }

  const assignments: RecalcResult['assignments'] = [];
  const skipped: RecalcResult['skipped'] = [];

  for (const t of tasks) {
    if (!t.category || LOCKED_TYPES.has(t.category) || t.category === 'meeting') {
      skipped.push({ taskId: t.id, title: t.title, reason: `${t.category || 'no category'} not slottable` });
      continue;
    }
    const matchIdx = slots.findIndex((s) => slotMatches(s, t.category) && s.remainingMin >= REMAINDER_MIN);
    if (matchIdx === -1) {
      skipped.push({ taskId: t.id, title: t.title, reason: 'no matching open block this week' });
      continue;
    }
    const slot = slots[matchIdx];
    const desired = t.estimated_minutes ?? 45;
    const taskMin = Math.min(desired, TASK_HARD_CAP_MIN, slot.remainingMin);

    await supabase
      .from('tasks')
      .update({ assigned_block_id: slot.id, momentum_score: computeMomentum(t) })
      .eq('id', t.id);

    assignments.push({ taskId: t.id, title: t.title, blockId: slot.id, minutes: taskMin });

    // Reduce slot capacity by task minutes + 10-min break
    slot.remainingMin -= taskMin + 10;
    if (slot.remainingMin < REMAINDER_MIN) {
      slots.splice(matchIdx, 1);
    }
  }

  // 5. One Thing: highest-momentum assigned task in a HIGH-energy block → is_pinned
  // First, clear any prior pin
  await supabase.from('tasks').update({ is_pinned: false }).eq('user_id', USER_ID).eq('is_pinned', true);

  let oneThing: RecalcResult['oneThing'] = null;
  const candidates = assignments.filter((a) => {
    const slot = blocks.find((b) => blockId(b) === a.blockId);
    return slot?.energy === 'high';
  });
  const pool = candidates.length > 0 ? candidates : assignments;
  if (pool.length > 0) {
    // Already sorted by momentum desc since we processed tasks in that order.
    const winner = pool[0];
    await supabase.from('tasks').update({ is_pinned: true }).eq('id', winner.taskId);
    oneThing = { taskId: winner.taskId, title: winner.title, blockId: winner.blockId };
  }

  return {
    weekLabel,
    totalOpenTasks: tasks.length,
    assignedCount: assignments.length,
    skippedCount: skipped.length,
    oneThing,
    assignments,
    skipped,
  };
}
