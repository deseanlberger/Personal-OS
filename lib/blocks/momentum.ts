import type { Task } from '@/lib/types';

// Personal OS momentum scoring — ported from command-center/backend/momentum.js.
//   Score = priorityWeight + overdueBonus + stalePenalty
//   Priority comes from priority_score field (capped/anchored to 100/50/20).
//   Overdue: +10 per day past due_date for open tasks.
//   Stale:   +5 per day since created_at for open tasks.

function daysBetween(fromIso: string | null, now: Date): number {
  if (!fromIso) return 0;
  const from = new Date(fromIso).getTime();
  const diffMs = now.getTime() - from;
  return Math.floor(diffMs / 86_400_000);
}

export function computeMomentum(task: Task, now: Date = new Date()): number {
  // priority_score from the task; defaults to 0 (lowest)
  const priority = task.priority_score > 0 ? task.priority_score : 20;

  let overdue = 0;
  if (task.due_date && !task.completed_at) {
    const daysPast = daysBetween(task.due_date + 'T00:00:00', now);
    if (daysPast > 0) overdue = daysPast * 10;
  }

  let stale = 0;
  if (!task.completed_at) {
    const daysOpen = daysBetween(task.created_at, now);
    if (daysOpen > 0) stale = daysOpen * 5;
  }

  // Key tasks get a big bump
  const keyBonus = task.key ? 50 : 0;

  return priority + overdue + stale + keyBonus;
}
