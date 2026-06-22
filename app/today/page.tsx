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
const HOUR_HEIGHT_PX = 80; // px per hour in the timeline column

const TYPE_TONE: Record<string, string> = {
  'deep-thinking': 'border-blue-400/30 bg-blue-400/[0.08]',
  'deep-admin': 'border-yellow-400/30 bg-yellow-400/[0.08]',
  'multitask-admin': 'border-orange-400/30 bg-orange-400/[0.08]',
  'meeting': 'border-emerald-400/30 bg-emerald-400/[0.08]',
  'coaching': 'border-white/15 bg-white/[0.06]',
  'personal': 'border-white/10 bg-white/[0.03]',
  'flex': 'border-sky-400/30 bg-sky-400/[0.08]',
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

function parseHHMM(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtCountdown(min: number): string {
  if (min < 1) return 'now';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay();
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
  const [dayOffset, setDayOffset] = useState(0);
  const [overrideOpen, setOverrideOpen] = useState(false);

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

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const { currentBlock, nextBlock } = useMemo(() => {
    if (!isToday) return { currentBlock: null, nextBlock: todayBlocks[0] || null };
    let curr: Block | null = null;
    let next: Block | null = null;
    for (const b of todayBlocks) {
      const s = parseHHMM(b.start);
      const e = parseHHMM(b.end);
      if (s <= nowMin && e > nowMin) curr = b;
      else if (s > nowMin && !next) next = b;
    }
    return { currentBlock: curr, nextBlock: next };
  }, [todayBlocks, nowMin, isToday]);

  const headerLabel = useMemo(() => {
    if (dayOffset === 0) return 'Today';
    if (dayOffset === -1) return 'Yesterday';
    if (dayOffset === 1) return 'Tomorrow';
    return selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
  }, [dayOffset, selectedDate]);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
              {headerLabel} · {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h1>
            <p className="mt-1 text-sm text-white/55">
              Live timeline from 5 AM to 9 PM. Blocks span their full duration.
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

        {err && (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{err}</div>
        )}

        {/* C — Now + Next focus card */}
        {isToday && <NowNextCard currentBlock={currentBlock} nextBlock={nextBlock} nowMin={nowMin} />}

        {/* A — Pure absolute timeline */}
        <TimelineColumn todayBlocks={todayBlocks} now={now} isToday={isToday} weekOffset={weekOffset} onChanged={() => fetchBlocks(weekOffset)} />

        {/* One-off override controls */}
        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.02] p-3 text-[12px]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300/70">One-off override</div>
              <div className="mt-0.5 text-white/55">
                Add a block just for{' '}
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.
              </div>
            </div>
            <button
              onClick={() => setOverrideOpen((v) => !v)}
              className="min-h-9 shrink-0 rounded-md border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300 hover:bg-amber-400/25"
            >
              {overrideOpen ? 'Close' : '+ Add block'}
            </button>
          </div>
          {overrideOpen && (
            <OverrideForm
              date={selectedDate}
              onSaved={async () => {
                await fetchBlocks(weekOffset);
                setOverrideOpen(false);
              }}
              onError={(msg) => setErr(msg)}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

function NowNextCard({
  currentBlock,
  nextBlock,
  nowMin,
}: {
  currentBlock: Block | null;
  nextBlock: Block | null;
  nowMin: number;
}) {
  if (!currentBlock && !nextBlock) {
    return (
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Day complete</div>
        <div className="mt-1 text-sm text-white/55">Nothing else scheduled. Rest, ship, or set tomorrow up.</div>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
      {/* RIGHT NOW */}
      <div className={`rounded-xl border p-4 ${currentBlock ? TYPE_TONE[currentBlock.type] || TYPE_TONE.personal : 'border-white/[0.06] bg-white/[0.02]'}`}>
        <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">
          {currentBlock ? 'Right now' : 'Free time'}
        </div>
        {currentBlock ? (
          <>
            <div className="mt-1 text-xl font-medium text-white/95">{currentBlock.name}</div>
            <div className="num mt-0.5 text-[11px] uppercase tracking-[0.14em] text-white/55">
              {to12h(currentBlock.start)} – {to12h(currentBlock.end)} · {TYPE_LABEL[currentBlock.type] || currentBlock.type}
              {currentBlock.energy && ` · ${currentBlock.energy} energy`}
              {' · ends in '}{fmtCountdown(parseHHMM(currentBlock.end) - nowMin)}
            </div>
            {currentBlock.assigned_tasks.length > 0 && (
              <ul className="mt-3 space-y-1">
                {currentBlock.assigned_tasks.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 text-[13px] text-white/85">
                    {t.is_pinned && <span className="text-emerald-300">⭐</span>}
                    {t.key && !t.is_pinned && <span className="text-amber-300">★</span>}
                    <span className="flex-1">{t.title}</span>
                    {t.estimated_minutes && <span className="num text-[10px] text-white/35">{t.estimated_minutes}m</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : nextBlock ? (
          <>
            <div className="mt-1 text-xl font-medium text-white/85">
              Free until {to12h(nextBlock.start)}
            </div>
            <div className="num mt-0.5 text-[11px] uppercase tracking-[0.14em] text-white/40">
              {fmtCountdown(parseHHMM(nextBlock.start) - nowMin)} of open time
            </div>
          </>
        ) : null}
      </div>

      {/* NEXT UP */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Next up</div>
        {nextBlock ? (
          <>
            <div className="mt-1 text-sm font-medium text-white/85">{nextBlock.name}</div>
            <div className="num mt-0.5 text-[11px] uppercase tracking-[0.14em] text-white/40">
              {to12h(nextBlock.start)} · in {fmtCountdown(parseHHMM(nextBlock.start) - nowMin)}
            </div>
            {nextBlock.assigned_tasks.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {nextBlock.assigned_tasks.slice(0, 3).map((t) => (
                  <li key={t.id} className="truncate text-[11px] text-white/60">
                    · {t.title}
                  </li>
                ))}
                {nextBlock.assigned_tasks.length > 3 && (
                  <li className="text-[10px] text-white/30">+ {nextBlock.assigned_tasks.length - 3} more</li>
                )}
              </ul>
            )}
          </>
        ) : (
          <div className="mt-1 text-sm text-white/40">Nothing else today</div>
        )}
      </div>
    </section>
  );
}

function TimelineColumn({
  todayBlocks,
  now,
  isToday,
  weekOffset,
  onChanged,
}: {
  todayBlocks: Block[];
  now: Date;
  isToday: boolean;
  weekOffset: number;
  onChanged: () => void | Promise<void>;
}) {
  const gridStartMin = HOUR_START * 60;
  const totalMin = (HOUR_END - HOUR_START + 1) * 60;
  const totalHeight = (totalMin / 60) * HOUR_HEIGHT_PX;
  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowOffsetPx = (nowH * 60 + nowM - gridStartMin) / 60 * HOUR_HEIGHT_PX;
  const showNowLine = isToday && nowH >= HOUR_START && nowH <= HOUR_END;

  return (
    <div
      className="relative rounded-xl border border-white/[0.06] bg-white/[0.02]"
      style={{ height: totalHeight }}
    >
      {/* Hour ticks (left margin) */}
      {HOURS.map((hour, i) => (
        <div
          key={hour}
          className={`absolute left-0 right-0 ${i > 0 ? 'border-t border-white/[0.03]' : ''}`}
          style={{ top: i * HOUR_HEIGHT_PX }}
        >
          <div className="num absolute left-3 top-1 text-[10px] text-white/30">
            {to12h(`${String(hour).padStart(2, '0')}:00`)}
          </div>
        </div>
      ))}

      {/* Half-hour ticks for finer reading */}
      {HOURS.map((hour, i) => (
        <div
          key={`half-${hour}`}
          className="absolute left-16 right-0 border-t border-white/[0.015]"
          style={{ top: i * HOUR_HEIGHT_PX + HOUR_HEIGHT_PX / 2 }}
        />
      ))}

      {/* Now line */}
      {showNowLine && (
        <div
          className="absolute left-0 right-0 z-30 flex items-center"
          style={{ top: nowOffsetPx }}
        >
          <div className="num ml-1 w-12 text-right text-[9px] font-medium text-emerald-300">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </div>
          <div className="ml-1 size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          <div className="h-px flex-1 bg-emerald-400/60" />
        </div>
      )}

      {/* Blocks */}
      {todayBlocks.map((b) => {
        const startMin = parseHHMM(b.start);
        const endMin = parseHHMM(b.end);
        const top = (startMin - gridStartMin) / 60 * HOUR_HEIGHT_PX;
        const height = (endMin - startMin) / 60 * HOUR_HEIGHT_PX;
        const isOverride = !!b.is_override;
        const tone = TYPE_TONE[b.type] || TYPE_TONE.personal;
        const isActive = b.day === now.getDay() && startMin <= nowH * 60 + nowM && endMin > nowH * 60 + nowM && isToday;
        return (
          <div
            key={b.id}
            className={`absolute left-16 right-2 z-10 overflow-hidden rounded-md border px-2.5 py-1.5 transition ${
              isOverride
                ? 'border-amber-400/50 bg-amber-400/[0.10]'
                : tone
            } ${isActive ? 'ring-1 ring-emerald-400/40' : ''}`}
            style={{ top: top + 1, height: Math.max(height - 2, 22) }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white/90">
                  {b.name}
                  {isOverride && (
                    <span className="ml-2 rounded border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-amber-300">
                      ONE-OFF
                    </span>
                  )}
                </div>
                <div className="num truncate text-[10px] uppercase tracking-[0.14em] text-white/45">
                  {to12h(b.start)} – {to12h(b.end)} · {TYPE_LABEL[b.type] || b.type}
                  {b.energy && ` · ${b.energy}`}
                </div>
              </div>
              {isOverride && b.override_id && (
                <button
                  onClick={async () => {
                    if (!confirm(`Remove "${b.name}"?`)) return;
                    await fetch(`/api/calendar/overrides/${b.override_id}`, { method: 'DELETE' });
                    await onChanged();
                  }}
                  className="shrink-0 text-[11px] text-amber-300/70 hover:text-amber-300"
                  aria-label="Remove override"
                >
                  ✕
                </button>
              )}
            </div>
            {b.assigned_tasks.length > 0 && height >= 60 && (
              <ul className="mt-1 space-y-0.5">
                {b.assigned_tasks.slice(0, Math.floor((height - 40) / 18)).map((t) => (
                  <li key={t.id} className="flex items-center gap-1 truncate text-[11px] text-white/75">
                    {t.is_pinned && <span className="text-emerald-300">⭐</span>}
                    {t.key && !t.is_pinned && <span className="text-amber-300">★</span>}
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
                {b.assigned_tasks.length > Math.floor((height - 40) / 18) && (
                  <li className="text-[9px] text-white/30">+ {b.assigned_tasks.length - Math.floor((height - 40) / 18)} more</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
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
