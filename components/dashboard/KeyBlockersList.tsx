'use client';

import { useCallback, useEffect, useState } from 'react';
import { EVENTS, onEvent } from '@/lib/events';
import type { Task } from '@/lib/types';

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

export function KeyBlockersList() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?status=open&key=true&limit=20', { cache: 'no-store' });
      if (!res.ok) throw new Error(`tasks fetch ${res.status}`);
      const body = await res.json();
      const open = (body.tasks as Task[]).sort((a, b) => {
        // Stuck longest first
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      });
      setTasks(open.slice(0, 5));
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
    return <p className="text-sm text-white/40">No key blockers. Mark a task as ★ Key in Telegram or the CRM.</p>;
  }

  return (
    <ul className="mt-2 flex flex-col divide-y divide-white/[0.04]">
      {tasks.map((t) => {
        const stuck = daysSince(t.updated_at);
        const tone = stuck >= 7 ? 'text-red-400/80 border-red-400/30 bg-red-400/10' : 'text-amber-300/80 border-amber-300/30 bg-amber-300/10';
        const label = stuck >= 7 ? 'HOT' : 'WARM';
        return (
          <li key={t.id} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white/85">{t.title}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/40">
                STUCK <span className="num">{stuck}</span>d
              </div>
            </div>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-[0.18em] ${tone}`}>
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
