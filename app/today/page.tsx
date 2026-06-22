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

export default function TodayPage() {
  const [data, setData] = useState<BlocksResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/blocks?weekOffset=0', { cache: 'no-store' });
      if (!res.ok) throw new Error(`blocks ${res.status}`);
      const body = (await res.json()) as BlocksResponse;
      setData(body);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchBlocks();
    return onEvent(EVENTS.TASK_CHANGED, fetchBlocks);
  }, [fetchBlocks]);

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
      await fetchBlocks();
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

  const today = now.getDay();
  const todayBlocks = useMemo(() => {
    if (!data) return [];
    return data.blocks
      .filter((b) => b.day === today)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [data, today]);

  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowOffsetPct = ((nowM / 60) * 100).toFixed(1);
  const showNowLine = nowH >= HOUR_START && nowH <= HOUR_END;

  const taskCount = todayBlocks.reduce((sum, b) => sum + b.assigned_tasks.length, 0);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
              Today · {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
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

        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
          <span className="num">{todayBlocks.length} blocks</span>
          <span className="num">{taskCount} tasks</span>
        </div>

        {err && (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{err}</div>
        )}

        {/* Hourly grid */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
          {HOURS.map((hour) => {
            const hourBlocks = todayBlocks.filter((b) => blockOverlapsHour(b, hour));
            const startBlocks = hourBlocks.filter((b) => blockStartsInHour(b, hour));
            const continuingBlocks = hourBlocks.filter((b) => !blockStartsInHour(b, hour));
            const isNowHour = hour === nowH;
            return (
              <div
                key={hour}
                className={`relative flex min-h-16 items-stretch border-b border-white/[0.04] last:border-b-0 ${
                  isNowHour ? 'bg-emerald-400/[0.025]' : ''
                }`}
              >
                <div className="num w-16 shrink-0 border-r border-white/[0.04] px-3 py-2 text-[11px] text-white/40">
                  {to12h(`${String(hour).padStart(2, '0')}:00`)}
                </div>
                <div className="relative flex-1 px-3 py-2">
                  {/* Now indicator */}
                  {isNowHour && showNowLine && (
                    <div
                      className="absolute left-0 right-0 z-10 flex items-center"
                      style={{ top: `${nowOffsetPct}%` }}
                    >
                      <div className="mr-1 size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                      <div className="h-px flex-1 bg-emerald-400/60" />
                    </div>
                  )}

                  {hourBlocks.length === 0 && (
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/20">—</div>
                  )}

                  {continuingBlocks.length > 0 && (
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-white/30">
                      ↑ continuing: {continuingBlocks.map((b) => b.name).join(' · ')}
                    </div>
                  )}

                  {startBlocks.map((b) => {
                    const tone = TYPE_TONE[b.type] || TYPE_TONE.personal;
                    return (
                      <div
                        key={b.id}
                        className={`mb-1.5 rounded-md border px-2.5 py-1.5 ${tone} last:mb-0`}
                      >
                        <div className="flex items-baseline justify-between">
                          <div className="text-sm font-medium text-white/90">{b.name}</div>
                          <div className="num text-[10px] text-white/50">
                            {to12h(b.start)} – {to12h(b.end)}
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
                              <li
                                key={t.id}
                                className="flex items-center gap-1.5 text-[12px] text-white/80"
                              >
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
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
