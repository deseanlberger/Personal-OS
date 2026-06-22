'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';
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
  is_override?: boolean;
  override_id?: string | null;
  assigned_tasks: { id: string; title: string; estimated_minutes: number | null; is_pinned: boolean; key: boolean }[];
};

type BlocksResponse = {
  weekLabel: 'A' | 'B';
  weekOffset: number;
  weekStart: string;
  isCurrentWeek: boolean;
  blocks: Block[];
};

const HOUR_START = 5; // 5 AM
const HOUR_END = 21; // 9 PM
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

const TYPE_TONE: Record<string, string> = {
  'deep-thinking': 'border-blue-400/30 bg-blue-400/[0.06]',
  'deep-admin': 'border-yellow-400/30 bg-yellow-400/[0.06]',
  'multitask-admin': 'border-orange-400/30 bg-orange-400/[0.06]',
  'meeting': 'border-emerald-400/30 bg-emerald-400/[0.06]',
  'coaching': 'border-white/15 bg-white/[0.04]',
  'personal': 'border-white/10 bg-white/[0.02]',
  'flex': 'border-sky-400/30 bg-sky-400/[0.06]',
};

const TYPE_LABEL: Record<string, string> = {
  'deep-thinking': 'Think',
  'deep-admin': 'Admin',
  'multitask-admin': 'Multi',
  'meeting': 'Meet',
  'coaching': 'Coach',
  'personal': 'Personal',
  'flex': 'Flex',
};

function parseHHMM(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h, m };
}

function blockOverlapsHour(b: Block, hour: number): boolean {
  const s = parseHHMM(b.start);
  const e = parseHHMM(b.end);
  const sMin = s.h * 60 + s.m;
  const eMin = e.h * 60 + e.m;
  const hourStart = hour * 60;
  const hourEnd = (hour + 1) * 60;
  return sMin < hourEnd && eMin > hourStart;
}

function blockStartsInHour(b: Block, hour: number): boolean {
  const s = parseHHMM(b.start);
  return s.h === hour;
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0 Sun..6 Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offsetToMon);
  return x;
}

export default function TodayPage() {
  const [data, setData] = useState<BlocksResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  // 0 = today, +1 = tomorrow, -1 = yesterday, etc.
  const [dayOffset, setDayOffset] = useState(0);

  const selectedDate = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [now, dayOffset]);

  const weekOffset = useMemo(() => {
    const todayMonday = mondayOf(now);
    const selMonday = mondayOf(selectedDate);
    const diffDays = Math.round((selMonday.getTime() - todayMonday.getTime()) / 86_400_000);
    return Math.round(diffDays / 7);
  }, [now, selectedDate]);

  const fetchBlocks = useCallback(async (offset: number) => {
    try {
      const res = await fetch(`/api/calendar/blocks?weekOffset=${offset}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`blocks ${res.status}`);
      const body = (await res.json()) as BlocksResponse;
      setData(body);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchBlocks(weekOffset);
    return onEvent(EVENTS.TASK_CHANGED, () => fetchBlocks(weekOffset));
  }, [fetchBlocks, weekOffset]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const [overrideForm, setOverrideForm] = useState<null | { open: true }>(null);

  const refreshWeek = async () => {
    setRefreshing(true);
    setRefreshSummary(null);
    try {
      const res = await fetch('/api/tasks/refresh-week', { method: 'POST' });
      const body = (await res.json()) as {
        classified?: number;
        assigned?: number;
        overflow?: number;
        skipped?: number;
      };
      await fetchBlocks(weekOffset);
      emit(EVENTS.TASK_CHANGED);
      const parts: string[] = [];
      if (body.classified) parts.push(`${body.classified} classified`);
      if (typeof body.assigned === 'number') parts.push(`${body.assigned} assigned`);
      if (typeof body.overflow === 'number' && body.overflow > 0) parts.push(`${body.overflow} → next wk`);
      if (body.skipped) parts.push(`${body.skipped} skipped`);
      setRefreshSummary(parts.length ? `✓ ${parts.join(' · ')}` : '✓ Refreshed');
      setTimeout(() => setRefreshSummary(null), 5000);
    } catch (e) {
      setRefreshSummary(`⚠ ${(e as Error).message}`);
      setTimeout(() => setRefreshSummary(null), 5000);
    } finally {
      setRefreshing(false);
    }
  };

  const selectedDayOfWeek = selectedDate.getDay();
  const isToday = dayOffset === 0;
  const todayBlocks = useMemo(() => {
    if (!data) return [];
    return data.blocks
      .filter((b) => b.day === selectedDayOfWeek)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [data, selectedDayOfWeek]);

  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowOffsetPct = ((nowM / 60) * 100).toFixed(1);
  const showNowLine = isToday && nowH >= HOUR_START && nowH <= HOUR_END;

  const taskCount = todayBlocks.reduce((sum, b) => sum + b.assigned_tasks.length, 0);

  const headerLabel = useMemo(() => {
    if (dayOffset === 0) return 'Today';
    if (dayOffset === -1) return 'Yesterday';
    if (dayOffset === 1) return 'Tomorrow';
    return selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
  }, [dayOffset, selectedDate]);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
              {headerLabel} · {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h1>
            <p className="mt-1 text-sm text-white/55">
              Every hour from 5 AM to 9 PM. Tasks slot into their assigned blocks automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {refreshSummary && (
              <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">{refreshSummary}</span>
            )}
            <button
              onClick={refreshWeek}
              disabled={refreshing}
              className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
            >
              {refreshing ? 'Refreshing…' : 'Refresh Week'}
            </button>
          </div>
        </header>

        {/* Day navigation */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <button
            onClick={() => setDayOffset((v) => v - 1)}
            aria-label="Previous day"
            className="flex min-h-9 min-w-9 items-center justify-center rounded-md border border-white/10 text-white/60 transition hover:bg-white/[0.04] hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex flex-1 items-center justify-center gap-3">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">{headerLabel}</div>
              <div className="num text-[11px] text-white/70">
                {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
            {!isToday && (
              <button
                onClick={() => setDayOffset(0)}
                className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/20"
              >
                Today
              </button>
            )}
          </div>
          <button
            onClick={() => setDayOffset((v) => v + 1)}
            aria-label="Next day"
            className="flex min-h-9 min-w-9 items-center justify-center rounded-md border border-white/10 text-white/60 transition hover:bg-white/[0.04] hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
          <span className="num">{todayBlocks.length} blocks</span>
          <span className="num">{taskCount} tasks</span>
          {weekOffset !== 0 && (
            <span className="text-amber-300/70">· {weekOffset > 0 ? 'next' : 'past'} week view</span>
          )}
        </div>

        {err && (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{err}</div>
        )}

        {/* Hourly grid */}
        <HourlyGrid
          todayBlocks={todayBlocks}
          nowH={nowH}
          nowM={nowM}
          showNowLine={showNowLine}
          weekOffset={weekOffset}
          fetchBlocks={fetchBlocks}
        />

        {/* One-off block override for this day */}
        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.02] p-3 text-[12px]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300/70">
                One-off override
              </div>
              <div className="mt-0.5 text-white/55">
                Add a block just for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} —
                covering shifts, doctor visits, anything off-template.
              </div>
            </div>
            <button
              onClick={() => setOverrideForm(overrideForm ? null : { open: true })}
              className="min-h-9 shrink-0 rounded-md border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300 hover:bg-amber-400/25"
            >
              {overrideForm ? 'Close' : '+ Add block'}
            </button>
          </div>
          {overrideForm && (
            <OverrideForm
              date={selectedDate}
              onSaved={async () => {
                await fetchBlocks(weekOffset);
                setOverrideForm(null);
              }}
              onError={(msg) => setErr(msg)}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

const OVERRIDE_TYPES = [
  { value: 'coaching', label: 'Coaching' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'personal', label: 'Personal' },
  { value: 'deep-thinking', label: 'Deep Thinking' },
  { value: 'deep-admin', label: 'Deep Admin' },
  { value: 'multitask-admin', label: 'Multi Admin' },
  { value: 'flex', label: 'Flex' },
] as const;

const HOUR_HEIGHT_PX = 72;

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function HourlyGrid({
  todayBlocks,
  nowH,
  nowM,
  showNowLine,
  weekOffset,
  fetchBlocks,
}: {
  todayBlocks: Block[];
  nowH: number;
  nowM: number;
  showNowLine: boolean;
  weekOffset: number;
  fetchBlocks: (offset: number) => Promise<void>;
}) {
  const gridStartMin = HOUR_START * 60;
  const totalMin = (HOUR_END - HOUR_START + 1) * 60;
  const totalHeight = (totalMin / 60) * HOUR_HEIGHT_PX;
  const nowOffsetPx = ((nowH * 60 + nowM) - gridStartMin) / 60 * HOUR_HEIGHT_PX;

  return (
    <div className="relative rounded-xl border border-white/[0.06] bg-white/[0.02]" style={{ height: totalHeight }}>
      {/* Hour rows (background grid) */}
      {HOURS.map((hour, i) => {
        const isNowHour = hour === nowH;
        return (
          <div
            key={hour}
            className={`absolute left-0 right-0 border-t border-white/[0.04] ${i === 0 ? 'border-t-0' : ''} ${
              isNowHour ? 'bg-emerald-400/[0.025]' : ''
            }`}
            style={{ top: i * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}
          >
            <div className="num absolute left-3 top-1.5 text-[11px] text-white/40">
              {to12h(`${String(hour).padStart(2, '0')}:00`)}
            </div>
          </div>
        );
      })}

      {/* Now line */}
      {showNowLine && (
        <div
          className="absolute left-16 right-0 z-20 flex items-center"
          style={{ top: nowOffsetPx }}
        >
          <div className="mr-1 size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          <div className="h-px flex-1 bg-emerald-400/60" />
        </div>
      )}

      {/* Blocks: absolutely positioned, height proportional to duration */}
      {todayBlocks.map((b) => {
        const startMin = timeToMin(b.start) - gridStartMin;
        const endMin = timeToMin(b.end) - gridStartMin;
        const top = (startMin / 60) * HOUR_HEIGHT_PX;
        const height = ((endMin - startMin) / 60) * HOUR_HEIGHT_PX;
        const tone = TYPE_TONE[b.type] || TYPE_TONE.personal;
        const isOverride = !!b.is_override;
        return (
          <div
            key={b.id}
            className={`absolute left-16 right-2 z-10 overflow-hidden rounded-md border px-2.5 py-1.5 ${
              isOverride ? 'border-amber-400/40 bg-amber-400/[0.08]' : tone
            }`}
            style={{ top: top + 2, height: Math.max(height - 4, 24) }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-medium text-white/90">
                {b.name}
                {isOverride && (
                  <span className="ml-2 rounded border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-amber-300">
                    ONE-OFF
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="num text-[10px] text-white/50">
                  {to12h(b.start)} – {to12h(b.end)}
                </div>
                {isOverride && b.override_id && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove "${b.name}"?`)) return;
                      await fetch(`/api/calendar/overrides/${b.override_id}`, { method: 'DELETE' });
                      await fetchBlocks(weekOffset);
                    }}
                    className="text-[10px] text-amber-300/70 hover:text-amber-300"
                    aria-label="Remove override"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/40">
              {TYPE_LABEL[b.type] || b.type}
              {b.energy && ` · ${b.energy} energy`}
              {b.locked && ' · locked'}
            </div>
            {b.assigned_tasks.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {b.assigned_tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-1.5 text-[12px] text-white/80">
                    {t.is_pinned && <span className="text-emerald-300">⭐</span>}
                    {t.key && !t.is_pinned && <span className="text-amber-300">★</span>}
                    <span>{t.title}</span>
                    {t.estimated_minutes && (
                      <span className="num text-[10px] text-white/30">· {t.estimated_minutes}m</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverrideForm({
  date,
  onSaved,
  onError,
}: {
  date: Date;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('14:00');
  const [end, setEnd] = useState('15:30');
  const [type, setType] = useState<string>('coaching');
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const override_date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const res = await fetch('/api/calendar/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          override_date,
          start_time: start,
          end_time: end,
          name: name.trim(),
          type,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setName('');
      await onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What is it? (e.g. Jake basketball)"
        className="rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white/90 outline-none placeholder:text-white/30 sm:col-span-4"
      />
      <input
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="num rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white/90 outline-none"
      />
      <input
        type="time"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="num rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white/90 outline-none"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-sm text-white/90 outline-none"
      >
        {OVERRIDE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!name.trim() || pending}
        className="min-h-9 rounded-md border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-amber-300 hover:bg-amber-400/25 disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Save block'}
      </button>
    </form>
  );
}
