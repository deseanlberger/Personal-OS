'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EVENTS, onEvent, emit } from '@/lib/events';
import { to12h } from '@/lib/format';

type Block = {
  id: string;
  day: number;
  start: string;
  end: string;
  name: string;
  type: string;
  energy: string | null;
  locked: boolean;
  assigned_tasks: { id: string; title: string; estimated_minutes: number | null; is_pinned: boolean; key: boolean }[];
};

type BlocksResponse = {
  weekLabel: 'A' | 'B';
  weekOffset: number;
  weekStart: string;
  isCurrentWeek: boolean;
  blocks: Block[];
};

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
// Monday-first display: present as MON TUE WED THU FRI SAT SUN
const DISPLAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const TYPE_BADGE: Record<string, string> = {
  'deep-thinking': 'bg-blue-400/15 text-blue-300 border-blue-400/30',
  'deep-admin': 'bg-yellow-400/15 text-yellow-300 border-yellow-400/30',
  'multitask-admin': 'bg-orange-400/15 text-orange-300 border-orange-400/30',
  'meeting': 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  'coaching': 'bg-white/[0.06] text-white/60 border-white/15',
  'personal': 'bg-white/[0.04] text-white/45 border-white/10',
  'flex': 'bg-sky-400/15 text-sky-300 border-sky-400/30',
};

export function CalendarCard() {
  const [data, setData] = useState<BlocksResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(() => new Date().getDay());
  const [weekOffset, setWeekOffset] = useState(0);
  const [recalcStatus, setRecalcStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [recalcSummary, setRecalcSummary] = useState<string | null>(null);
  const userSelectedRef = useRef(false);

  const fetchBlocks = useCallback(async (offset: number) => {
    try {
      const res = await fetch(`/api/calendar/blocks?weekOffset=${offset}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`blocks fetch ${res.status}`);
      const body = (await res.json()) as BlocksResponse;
      setData(body);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchBlocks(weekOffset);
    // Only auto-refresh if viewing the current week (other weeks don't show assignments)
    if (weekOffset !== 0) return;
    return onEvent(EVENTS.TASK_CHANGED, () => fetchBlocks(0));
  }, [fetchBlocks, weekOffset]);

  // Auto-pick a sensible default day when data loads:
  //   1. Today if today has tasks
  //   2. Otherwise the nearest future day this week with tasks
  //   3. Otherwise today
  // User taps override this auto-pick for the rest of the session.
  useEffect(() => {
    if (!data || userSelectedRef.current) return;
    if (weekOffset !== 0) return;
    const today = new Date().getDay();
    const tasksToday = data.blocks.some((b) => b.day === today && b.assigned_tasks.length > 0);
    if (tasksToday) {
      setSelectedDay(today);
      return;
    }
    // Find next day in Mon-first display order with tasks
    const ordered: number[] = [1, 2, 3, 4, 5, 6, 0];
    const todayIdx = ordered.indexOf(today);
    const rotated = [...ordered.slice(todayIdx), ...ordered.slice(0, todayIdx)];
    for (const d of rotated) {
      if (data.blocks.some((b) => b.day === d && b.assigned_tasks.length > 0)) {
        setSelectedDay(d);
        return;
      }
    }
  }, [data, weekOffset]);

  const handleSelectDay = useCallback((day: number) => {
    userSelectedRef.current = true;
    setSelectedDay(day);
  }, []);

  const recalc = async () => {
    setRecalcStatus('pending');
    setRecalcSummary(null);
    try {
      // Use the meta-refresh endpoint: it classifies any uncategorized
      // tasks first, then runs recalcWeek().
      const res = await fetch('/api/tasks/refresh-week', { method: 'POST' });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      const body = (await res.json()) as {
        classified?: number;
        assigned?: number;
        skipped?: number;
      };
      // Refresh always targets the current week — jump back if user wandered
      setWeekOffset(0);
      await fetchBlocks(0);
      emit(EVENTS.TASK_CHANGED);
      setRecalcStatus('done');
      const parts: string[] = [];
      if (body.classified) parts.push(`${body.classified} classified`);
      if (typeof body.assigned === 'number') parts.push(`${body.assigned} assigned`);
      if (body.skipped) parts.push(`${body.skipped} skipped`);
      setRecalcSummary(parts.length ? `✓ ${parts.join(' · ')}` : '✓ Refreshed');
      setTimeout(() => {
        setRecalcStatus('idle');
        setRecalcSummary(null);
      }, 4000);
    } catch {
      setRecalcStatus('error');
      setTimeout(() => setRecalcStatus('idle'), 2500);
    }
  };

  const dayBlocks = useMemo(() => {
    if (!data) return [];
    return data.blocks.filter((b) => b.day === selectedDay);
  }, [data, selectedDay]);

  // Tasks-per-day map for the day-strip dots
  const taskCountByDay = useMemo(() => {
    const counts = new Map<number, number>();
    if (!data) return counts;
    for (const b of data.blocks) {
      if (b.assigned_tasks.length > 0) {
        counts.set(b.day, (counts.get(b.day) || 0) + b.assigned_tasks.length);
      }
    }
    return counts;
  }, [data]);

  // Build week strip with day-of-month numbers based on the target week's Monday
  const weekStrip = useMemo(() => {
    const today = new Date();
    // Compute target week's Monday from data.weekStart (server canonical) or fallback
    const monday = data?.weekStart
      ? new Date(data.weekStart + 'T00:00:00')
      : (() => {
          const m = new Date(today);
          m.setHours(0, 0, 0, 0);
          const dow = m.getDay();
          m.setDate(m.getDate() + (dow === 0 ? -6 : 1 - dow) + weekOffset * 7);
          return m;
        })();
    return DISPLAY_ORDER.map((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        day,
        label: DAY_LABELS[day],
        dom: d.getDate(),
        month: MONTHS[d.getMonth()],
        isToday: d.toDateString() === today.toDateString(),
        taskCount: taskCountByDay.get(day) || 0,
      };
    });
  }, [data?.weekStart, weekOffset, taskCountByDay]);

  // Pretty label for the week range, e.g. "May 18 – 24"
  const weekRangeLabel = useMemo(() => {
    if (weekStrip.length === 0) return '';
    const first = weekStrip[0];
    const last = weekStrip[weekStrip.length - 1];
    if (first.month === last.month) {
      return `${first.month} ${first.dom}–${last.dom}`;
    }
    return `${first.month} ${first.dom} – ${last.month} ${last.dom}`;
  }, [weekStrip]);

  if (err) {
    return <p className="text-sm text-red-400/80">⚠ {err}</p>;
  }

  return (
    <div>
      {/* Week navigation: ← prev / week range + label / next → */}
      <div className="flex items-center justify-between pb-2">
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          className="flex size-9 items-center justify-center rounded-md text-white/50 transition hover:bg-white/[0.04] hover:text-white/80"
          aria-label="Previous week"
        >
          ←
        </button>
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
            className={`text-sm font-medium transition ${
              weekOffset === 0 ? 'text-white/85' : 'text-white/50 hover:text-white/85'
            }`}
            title={weekOffset === 0 ? 'This week' : 'Jump to this week'}
          >
            {weekRangeLabel}
          </button>
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            · Week {data?.weekLabel ?? '–'}
            {weekOffset === 0 && ' · NOW'}
          </span>
        </div>
        <button
          onClick={() => setWeekOffset((w) => w + 1)}
          className="flex size-9 items-center justify-center rounded-md text-white/50 transition hover:bg-white/[0.04] hover:text-white/80"
          aria-label="Next week"
        >
          →
        </button>
      </div>

      {/* Week strip — MON TUE WED THU FRI SAT SUN */}
      <div className="grid grid-cols-7 gap-1 border-b border-white/[0.06] pb-3">
        {weekStrip.map((d) => {
          const isSelected = selectedDay === d.day;
          return (
            <button
              key={d.day}
              onClick={() => handleSelectDay(d.day)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-md px-1 py-2 transition ${
                isSelected
                  ? 'bg-white/[0.08] text-white'
                  : d.isToday && weekOffset === 0
                    ? 'text-emerald-300/90'
                    : 'text-white/40 hover:bg-white/[0.03] hover:text-white/70'
              }`}
            >
              <span className="text-[9px] uppercase tracking-[0.18em]">{d.label}</span>
              <span className="num mt-0.5 text-base">{String(d.dom).padStart(2, '0')}</span>
              {/* Task assignment indicator: small dot row or count */}
              <div className="mt-1 flex h-1.5 items-center gap-0.5">
                {d.taskCount > 0 ? (
                  d.taskCount <= 3 ? (
                    Array.from({ length: d.taskCount }).map((_, i) => (
                      <span key={i} className="size-1.5 rounded-full bg-emerald-400/70" />
                    ))
                  ) : (
                    <span className="num text-[9px] text-emerald-300/80">{d.taskCount}</span>
                  )
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Recalc + block count row */}
      <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-white/40">
        <div className="flex items-center gap-3">
          <span>
            {dayBlocks.length} block{dayBlocks.length === 1 ? '' : 's'}
            {!data?.isCurrentWeek && <span className="ml-2 text-white/30">· future view (no assignments)</span>}
          </span>
          <Link href="/settings/blocks" className="text-white/40 underline-offset-2 hover:text-white/70 hover:underline">
            edit template
          </Link>
        </div>
        <button
          onClick={recalc}
          disabled={recalcStatus === 'pending'}
          title={data?.isCurrentWeek ? 'Classify any new tasks + refresh this week' : 'Refresh the current week (jumps back)'}
          className={`min-h-9 rounded-md border px-2 py-1 transition disabled:opacity-40 ${
            recalcStatus === 'done'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
              : recalcStatus === 'error'
                ? 'border-red-400/40 bg-red-400/10 text-red-300'
                : 'border-white/10 text-white/60 hover:bg-white/[0.04]'
          }`}
        >
          {recalcStatus === 'pending'
            ? 'Refreshing…'
            : recalcStatus === 'done'
              ? recalcSummary || '✓ Refreshed'
              : recalcStatus === 'error'
                ? '⚠ Refresh'
                : 'Refresh Week'}
        </button>
      </div>

      {/* Blocks for selected day */}
      <div className="mt-3 flex flex-col divide-y divide-white/[0.04]">
        {dayBlocks.length === 0 && (
          <p className="py-4 text-sm text-white/40">No blocks for {DAY_LABELS[selectedDay]}.</p>
        )}
        {dayBlocks.map((b) => {
          const badgeStyle = TYPE_BADGE[b.type] || TYPE_BADGE.personal;
          const assigned = b.assigned_tasks;
          return (
            <div key={b.id} className="flex items-start gap-3 py-2.5">
              <div className="num shrink-0 text-[11px] leading-tight text-white/40">
                <div>{to12h(b.start)}</div>
                <div>{to12h(b.end)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm text-white/85">
                    {b.locked && '🔒 '}
                    {b.name}
                  </span>
                </div>
                {assigned.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {assigned.map((t) => (
                      <li key={t.id} className="flex items-center gap-1.5 text-[11px] text-white/65">
                        {t.is_pinned && <span className="text-amber-300">⭐</span>}
                        {t.key && !t.is_pinned && <span className="text-emerald-300/70">★</span>}
                        <span className="truncate">→ {t.title}</span>
                        {t.estimated_minutes && <span className="num text-white/40">({t.estimated_minutes}m)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] tracking-[0.18em] ${badgeStyle}`}>
                {b.type.toUpperCase().replace('-', ' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
