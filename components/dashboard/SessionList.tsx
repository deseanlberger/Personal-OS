'use client';

import { useCallback, useEffect, useState } from 'react';
import { EVENTS, onEvent } from '@/lib/events';
import { to12h } from '@/lib/format';
import type { Task } from '@/lib/types';

const URGENCY_LABEL: Record<string, string> = {
  today: 'Today',
  this_week: 'Week',
  this_month: 'Month',
  someday: 'Someday',
};

const CATEGORY_DOT: Record<string, string> = {
  'deep-thinking': 'bg-blue-400/80',
  'deep-admin': 'bg-yellow-400/80',
  'multitask-admin': 'bg-orange-400/80',
  'meeting': 'bg-emerald-400/80',
  'personal': 'bg-white/30',
  'flex': 'bg-sky-400/80',
};

// Format an assigned_block_id like "MON-12:00" into a friendly label
// relative to today. "MON-12:00" → "Mon · 12:00" or "Today · 12:00" if today is Mon.
const DAY_INDEX: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const DAY_LABEL: Record<string, string> = { SUN: 'Sun', MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' };

function formatBlock(blockId: string | null): string | null {
  if (!blockId) return null;
  const [day, time] = blockId.split('-', 2);
  if (!day || !time) return blockId;
  const friendlyTime = to12h(time);
  const todayIdx = new Date().getDay();
  const blockIdx = DAY_INDEX[day];
  if (blockIdx === todayIdx) return `Today · ${friendlyTime}`;
  if (blockIdx === (todayIdx + 1) % 7) return `Tomorrow · ${friendlyTime}`;
  return `${DAY_LABEL[day] || day} · ${friendlyTime}`;
}

export function SessionList() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?status=open&limit=20', { cache: 'no-store' });
      if (!res.ok) throw new Error(`tasks fetch ${res.status}`);
      const body = await res.json();
      const open = body.tasks as Task[];
      // Today + key tasks, ranked by priority_score then created_at desc.
      // If nothing has key=true today, fall back to top 3 by priority across all open tasks.
      const todayKey = open
        .filter((t) => t.urgency === 'today' && t.key)
        .sort((a, b) => b.priority_score - a.priority_score)
        .slice(0, 3);
      const top3 = todayKey.length > 0
        ? todayKey
        : open
            .sort((a, b) => {
              const aScore = a.priority_score + (a.urgency === 'today' ? 10 : a.urgency === 'this_week' ? 5 : 0);
              const bScore = b.priority_score + (b.urgency === 'today' ? 10 : b.urgency === 'this_week' ? 5 : 0);
              return bScore - aScore;
            })
            .slice(0, 3);
      setTasks(top3);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    return onEvent(EVENTS.TASK_CHANGED, fetchTasks);
  }, [fetchTasks]);

  if (err) return <p className="text-sm text-red-400/80">⚠ {err}</p>;
  if (tasks === null) return <p className="text-sm text-white/40">Loading…</p>;
  if (tasks.length === 0) {
    return <p className="text-sm text-white/40">No open tasks. Capture something below.</p>;
  }

  return (
    <ul className="mt-2 flex flex-col divide-y divide-white/[0.04]">
      {tasks.map((t) => {
        const slot = formatBlock(t.assigned_block_id);
        return (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <span className={`size-1.5 shrink-0 rounded-full ${t.category ? CATEGORY_DOT[t.category] || 'bg-white/30' : 'bg-white/30'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm text-white/85">{t.title}</span>
                {slot && (
                  <span className="num shrink-0 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    {slot}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
                <span>{URGENCY_LABEL[t.urgency] || t.urgency}</span>
                {t.category && <span>· {t.category}</span>}
                {t.estimated_minutes && <span className="num">· {t.estimated_minutes}m</span>}
                {t.key && <span className="text-emerald-300/70">· ★ KEY</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
