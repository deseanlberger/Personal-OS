'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localDateKey } from '@/lib/habits/date';
import { DEFAULT_HABITS, CATEGORY_TONE, type HabitDef } from '@/lib/habits/defaults';

const STORAGE_KEY_PREFIX = 'os-habits-v2-';

type Snapshot = {
  date: string;
  entries: Record<string, number>;       // today's values
  week_entries: Record<string, number>;  // this week's aggregate
};

function storageKey(date: string): string {
  return `${STORAGE_KEY_PREFIX}${date}`;
}

function readCache(date: string): Snapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(date));
    if (!raw) return null;
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

function writeCache(snap: Snapshot): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(snap.date), JSON.stringify(snap));
  } catch {}
}

function valueFor(snap: Snapshot, habit: HabitDef): number {
  if (habit.cadence === 'weekly') return snap.week_entries[habit.id] || 0;
  return snap.entries[habit.id] || 0;
}

export function HabitTracker({ habits = DEFAULT_HABITS }: { habits?: HabitDef[] }) {
  const [date, setDate] = useState<string>(() => localDateKey());
  const [snap, setSnap] = useState<Snapshot>(() => {
    const today = localDateKey();
    return readCache(today) || { date: today, entries: {}, week_entries: {} };
  });
  const dirtyRef = useRef(false);

  // Date rollover watcher (minute granularity)
  useEffect(() => {
    const t = setInterval(() => {
      const today = localDateKey();
      if (today !== date) {
        setDate(today);
        setSnap(readCache(today) || { date: today, entries: {}, week_entries: {} });
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [date]);

  // Hydrate from server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/habits/${date}`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as Snapshot;
        if (cancelled || dirtyRef.current) return;
        setSnap(body);
        writeCache(body);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [date]);

  const increment = useCallback(
    async (habit: HabitDef, delta: number) => {
      dirtyRef.current = true;
      // Optimistic update
      setSnap((prev) => {
        const nextEntries = { ...prev.entries };
        nextEntries[habit.id] = Math.max(0, (nextEntries[habit.id] || 0) + delta);
        const nextWeek = { ...prev.week_entries };
        nextWeek[habit.id] = Math.max(0, (nextWeek[habit.id] || 0) + delta);
        const out = { ...prev, entries: nextEntries, week_entries: nextWeek };
        writeCache(out);
        return out;
      });
      try {
        const res = await fetch(`/api/habits/${date}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ habit_id: habit.id, delta }),
        });
        if (res.ok) {
          const body = (await res.json()) as Snapshot;
          setSnap((prev) => {
            const out = { ...prev, entries: body.entries, week_entries: body.week_entries };
            writeCache(out);
            return out;
          });
        }
      } catch (err) {
        console.error('[HabitTracker] sync failed', err);
      }
      setTimeout(() => { dirtyRef.current = false; }, 500);
    },
    [date],
  );

  // Total completion score: sum of (capped pct) for each habit
  let totalScore = 0;
  for (const h of habits) {
    const v = valueFor(snap, h);
    totalScore += Math.min(1, v / h.target);
  }
  const totalPct = habits.length === 0 ? 0 : Math.round((totalScore / habits.length) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-white/[0.06] pb-2">
        <div className="flex items-baseline gap-3">
          <span className="num text-3xl text-white/90">{totalPct}%</span>
          <span className="text-xs text-white/40">{habits.length} habits</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
          Daily resets local · Weekly resets Mon
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {habits.map((h) => {
          const v = valueFor(snap, h);
          const pct = Math.min(100, Math.round((v / h.target) * 100));
          const isHit = v >= h.target;
          return (
            <div
              key={h.id}
              className={`group flex flex-col gap-1 rounded-md border px-3 py-2 transition ${
                isHit
                  ? 'border-emerald-400/40 bg-emerald-400/10'
                  : 'border-white/10 bg-black/30'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className={`size-1.5 shrink-0 self-center rounded-full ${CATEGORY_TONE[h.category]}`} />
                <span className={`text-sm leading-tight ${isHit ? 'text-emerald-200' : 'text-white/85'}`}>
                  {h.label}
                </span>
                <span className="ml-auto flex items-baseline gap-1 font-mono text-xs">
                  <span className={isHit ? 'text-emerald-300' : 'text-white/85'}>{v}</span>
                  <span className="text-white/30">/ {h.target} {h.unit}</span>
                </span>
              </div>
              {h.sub && (
                <span className="pl-[14px] text-[10px] uppercase tracking-[0.18em] text-white/35">
                  {h.sub} · {h.cadence}
                </span>
              )}
              {/* Progress bar */}
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className={`h-full transition-all ${
                    isHit ? 'bg-emerald-400/80' : 'bg-blue-400/60'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <button
                  onClick={() => increment(h, -h.step)}
                  className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-white/40 hover:bg-white/[0.04] hover:text-white/70"
                  aria-label={`Subtract ${h.step} ${h.unit}`}
                >
                  −{h.step}
                </button>
                <button
                  onClick={() => increment(h, h.step)}
                  className="flex-1 rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-emerald-300 hover:bg-emerald-400/20"
                >
                  + {h.step} {h.unit}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
