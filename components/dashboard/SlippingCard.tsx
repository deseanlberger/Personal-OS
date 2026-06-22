'use client';

import { useCallback, useEffect, useState } from 'react';
import { EVENTS, onEvent, emit } from '@/lib/events';

type UnplacedTask = {
  id: string;
  title: string;
  urgency: string;
  category: string | null;
  reason: string;
  created_at: string;
};

const URGENCY_TONE: Record<string, string> = {
  today: 'text-red-300 bg-red-400/10 border-red-400/30',
  this_week: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
  this_month: 'text-white/60 bg-white/[0.04] border-white/15',
  someday: 'text-white/40 bg-white/[0.02] border-white/10',
};

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function SlippingCard() {
  const [tasks, setTasks] = useState<UnplacedTask[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/unplaced', { cache: 'no-store' });
      if (!res.ok) throw new Error(`unplaced fetch ${res.status}`);
      const body = (await res.json()) as { unplaced: UnplacedTask[] };
      setTasks(body.unplaced || []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    return onEvent(EVENTS.TASK_CHANGED, fetchAll);
  }, [fetchAll]);

  const reclassify = async (taskId: string) => {
    setRetryingId(taskId);
    try {
      await fetch('/api/tasks/refresh-week', { method: 'POST' });
      emit(EVENTS.TASK_CHANGED);
    } finally {
      setRetryingId(null);
    }
  };

  if (err) {
    return (
      <section className="rounded-xl border border-red-400/30 bg-red-400/[0.04] p-4">
        <h2 className="text-[10px] uppercase tracking-[0.18em] text-red-300/70">Slipping</h2>
        <p className="mt-2 text-sm text-red-300/80">{err}</p>
      </section>
    );
  }

  if (tasks.length === 0) {
    return (
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-[10px] uppercase tracking-[0.18em] text-white/50">Slipping</h2>
        <p className="mt-2 text-[12px] text-white/40">
          Every open task is placed in a block. Nothing falling through.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[10px] uppercase tracking-[0.18em] text-amber-300/85">
          Slipping · {tasks.length}
        </h2>
        <button
          onClick={() => reclassify('all')}
          disabled={retryingId !== null}
          className="text-[10px] uppercase tracking-[0.18em] text-amber-300/70 hover:text-amber-300 disabled:opacity-40"
        >
          {retryingId === 'all' ? '…' : 'Retry all'}
        </button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {tasks.slice(0, 8).map((t) => {
          const age = daysSince(t.created_at);
          const tone = URGENCY_TONE[t.urgency] || URGENCY_TONE.someday;
          return (
            <li key={t.id} className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-black/20 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white/85">{t.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-white/40">
                  <span className={`rounded-sm border px-1.5 py-0.5 text-[9px] ${tone}`}>{t.urgency.replace('_', ' ')}</span>
                  <span className="text-white/30">{t.reason}</span>
                  {age > 0 && <span className="num text-white/30">· {age}d old</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {tasks.length > 8 && (
        <div className="mt-2 text-center text-[10px] uppercase tracking-[0.18em] text-white/40">
          + {tasks.length - 8} more
        </div>
      )}
    </section>
  );
}
