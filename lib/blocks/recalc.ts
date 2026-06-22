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

export type Assignment = {
  taskId: string;
  title: string;
  blockId: string;
  minutes: number;
  weekOffset: number;
};

export type RecalcResult = {
  weekLabel: WeekLabel;
  totalOpenTasks: number;
  assignedCount: number;
  overflowCount: number;
  skippedCount: number;
  oneThing: { taskId: string; title: string; blockId: string } | null;
  assignments: Assignment[];
  overflow: Assignment[];
  skipped: { taskId: string; title: string; reason: string }[];
};

type BlockSlot = { block: BlockTemplate; id: string; remainingMin: number; weekOffset: number };

function buildSlots(blocks: BlockTemplate[], weekOffset: number): BlockSlot[] {
  return blocks
    .filter((b) => !LOCKED_TYPES.has(b.type) && !b.locked)
    .map((b) => ({ block: b, id: blockId(b), remainingMin: blockMinutes(b), weekOffset }));
}

function slotMatches(slot: BlockSlot, taskCategory: string | null): boolean {
  if (!taskCategory) return false;
  if (slot.block.type === 'flex') return taskCategory === 'deep-thinking' || taskCategory === 'deep-admin';
  return slot.block.type === taskCategory;
}

/**
 * Reassign all open tasks to blocks across this week + next week.
 *
 * Two-pass strategy:
 *   - Pass 1: try the current week's REMAINING blocks (skips past blocks).
 *   - Pass 2: any task that couldn't fit overflows into next week's blocks.
 *
 * Tasks store both assigned_block_id and assigned_week_offset (0 = current,
 * 1 = next) so the calendar view can render each week's assignments.
 */
export async function recalcWeek(label?: WeekLabel): Promise<RecalcResult> {
  const currentLabel = label || (await getWeekLabel());
  const nextLabel: WeekLabel = currentLabel === 'A' ? 'B' : 'A';

  const [currentAll, nextAll] = await Promise.all([
    blocksForWeekFromDb(currentLabel),
    blocksForWeekFromDb(nextLabel),
  ]);

  const now = new Date();
  const weekStart = mondayOfWeek(now);

  // Current week: only blocks whose start time is still in the future.
  const currentBlocks = currentAll.filter((b) => {
    const { start } = blockDates(b, weekStart);
    return start.getTime() > now.getTime();
  });
  // Next week: every block is future.
  const nextBlocks = nextAll;

  // 1. Pull open tasks
  const { data: openTasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', USER_ID)
    .is('completed_at', null);
  if (error) throw new Error(`recalcWeek: tasks fetch failed: ${error.message}`);

  const tasks = (openTasks || []) as Task[];
  // Sort by urgency first (today > this_week > this_month > someday), then
  // momentum within each urgency band. So today-urgency tasks always get
  // first crack at today's remaining slots.
  const URGENCY_RANK: Record<string, number> = { today: 4, this_week: 3, this_month: 2, someday: 1 };
  tasks.sort((a, b) => {
    const ua = URGENCY_RANK[a.urgency || 'someday'] || 0;
    const ub = URGENCY_RANK[b.urgency || 'someday'] || 0;
    if (ub !== ua) return ub - ua;
    return computeMomentum(b) - computeMomentum(a);
  });

  // Clear previous assignments (both week offsets)
  if (tasks.length > 0) {
    await supabase
      .from('tasks')
      .update({ assigned_block_id: null, assigned_week_offset: 0 })
      .in('id', tasks.map((t) => t.id));
  }

  const slotsCurrent = buildSlots(currentBlocks, 0);
  const slotsNext = buildSlots(nextBlocks, 1);
  const todayDow = now.getDay();

  const assignments: Assignment[] = [];
  const overflow: Assignment[] = [];
  const skipped: RecalcResult['skipped'] = [];

  for (const t of tasks) {
    if (!t.category || LOCKED_TYPES.has(t.category) || t.category === 'meeting') {
      skipped.push({ taskId: t.id, title: t.title, reason: `${t.category || 'no category'} not slottable` });
      continue;
    }

    let matchIdx = -1;
    let slotArr = slotsCurrent;
    let weekOffset = 0;

    // urgency='today' MUST land today. Priority order:
    //   1. category-matching slot today
    //   2. any open slot today (ignore category match)
    //   3. category-matching slot anywhere this week
    //   4. category-matching slot next week
    //   5. any open slot this week
    if (t.urgency === 'today') {
      matchIdx = slotsCurrent.findIndex(
        (s) => s.block.day === todayDow && slotMatches(s, t.category) && s.remainingMin >= REMAINDER_MIN,
      );
      if (matchIdx === -1) {
        matchIdx = slotsCurrent.findIndex(
          (s) => s.block.day === todayDow && s.remainingMin >= REMAINDER_MIN,
        );
      }
    }

    // Category-matching slot anywhere this week
    if (matchIdx === -1) {
      matchIdx = slotsCurrent.findIndex(
        (s) => slotMatches(s, t.category) && s.remainingMin >= REMAINDER_MIN,
      );
    }

    // Category-matching slot next week
    if (matchIdx === -1) {
      matchIdx = slotsNext.findIndex(
        (s) => slotMatches(s, t.category) && s.remainingMin >= REMAINDER_MIN,
      );
      slotArr = slotsNext;
      weekOffset = 1;
    }

    // Final fallback for urgency='today': any current-week slot
    if (matchIdx === -1 && t.urgency === 'today') {
      matchIdx = slotsCurrent.findIndex((s) => s.remainingMin >= REMAINDER_MIN);
      slotArr = slotsCurrent;
      weekOffset = 0;
    }

    if (matchIdx === -1) {
      skipped.push({ taskId: t.id, title: t.title, reason: 'no matching block this week or next' });
      continue;
    }

    const slot = slotArr[matchIdx];
    const desired = t.estimated_minutes ?? 45;
    const taskMin = Math.min(desired, TASK_HARD_CAP_MIN, slot.remainingMin);

    await supabase
      .from('tasks')
      .update({
        assigned_block_id: slot.id,
        assigned_week_offset: weekOffset,
        momentum_score: computeMomentum(t),
      })
      .eq('id', t.id);

    const entry: Assignment = {
      taskId: t.id,
      title: t.title,
      blockId: slot.id,
      minutes: taskMin,
      weekOffset,
    };
    if (weekOffset === 0) assignments.push(entry);
    else overflow.push(entry);

    slot.remainingMin -= taskMin + 10;
    if (slot.remainingMin < REMAINDER_MIN) {
      slotArr.splice(matchIdx, 1);
    }
  }

  // Pass 2 — fill remaining current-week slots so no block is ever empty
  // when there are tasks available. First pull from skipped (no category
  // match found), then pull tasks placed in next week back into today.
  const assignedTaskIds = new Set(assignments.map((a) => a.taskId).concat(overflow.map((a) => a.taskId)));
  const slottableLeftovers = tasks.filter(
    (t) => !assignedTaskIds.has(t.id) && t.category && !LOCKED_TYPES.has(t.category) && t.category !== 'meeting',
  );
  for (const slot of [...slotsCurrent]) {
    if (slot.remainingMin < REMAINDER_MIN) continue;
    // Prefer unplaced tasks first
    let pulled: Task | null = null;
    const leftoverIdx = slottableLeftovers.findIndex((t) => (t.estimated_minutes ?? 45) <= TASK_HARD_CAP_MIN || slot.remainingMin >= REMAINDER_MIN);
    if (leftoverIdx !== -1) {
      pulled = slottableLeftovers[leftoverIdx];
      slottableLeftovers.splice(leftoverIdx, 1);
    } else {
      // Steal from next-week overflow — pull the lowest-priority overflow task back
      const stealIdx = overflow.length - 1;
      if (stealIdx >= 0) {
        const stolen = overflow.splice(stealIdx, 1)[0];
        pulled = tasks.find((t) => t.id === stolen.taskId) || null;
      }
    }
    if (!pulled) continue;
    const desired = pulled.estimated_minutes ?? 45;
    const taskMin = Math.min(desired, TASK_HARD_CAP_MIN, slot.remainingMin);
    await supabase
      .from('tasks')
      .update({
        assigned_block_id: slot.id,
        assigned_week_offset: 0,
        momentum_score: computeMomentum(pulled),
      })
      .eq('id', pulled.id);
    assignments.push({ taskId: pulled.id, title: pulled.title, blockId: slot.id, minutes: taskMin, weekOffset: 0 });
    slot.remainingMin -= taskMin + 10;
    if (slot.remainingMin < REMAINDER_MIN) {
      const idx = slotsCurrent.indexOf(slot);
      if (idx !== -1) slotsCurrent.splice(idx, 1);
    }
  }
  // Remove pass-2 pulled tasks from the skipped list
  const stillSkipped = skipped.filter((s) => !assignments.find((a) => a.taskId === s.taskId));
  skipped.length = 0;
  skipped.push(...stillSkipped);

  // 2. One Thing: highest-momentum task in a HIGH-energy current-week block → is_pinned
  await supabase.from('tasks').update({ is_pinned: false }).eq('user_id', USER_ID).eq('is_pinned', true);

  let oneThing: RecalcResult['oneThing'] = null;
  const candidates = assignments.filter((a) => {
    const slot = currentBlocks.find((b) => blockId(b) === a.blockId);
    return slot?.energy === 'high';
  });
  const pool = candidates.length > 0 ? candidates : assignments;
  if (pool.length > 0) {
    const winner = pool[0];
    await supabase.from('tasks').update({ is_pinned: true }).eq('id', winner.taskId);
    oneThing = { taskId: winner.taskId, title: winner.title, blockId: winner.blockId };
  }

  return {
    weekLabel: currentLabel,
    totalOpenTasks: tasks.length,
    assignedCount: assignments.length,
    overflowCount: overflow.length,
    skippedCount: skipped.length,
    oneThing,
    assignments,
    overflow,
    skipped,
  };
}
