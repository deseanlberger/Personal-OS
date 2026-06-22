'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

type Entry = {
  id: string;
  raw_text: string;
  summary: string;
  kind: string;
  tags: string[];
  source: string;
  created_at: string;
};

const KIND_TONE: Record<string, string> = {
  journal: 'border-blue-400/30 bg-blue-400/[0.06] text-blue-300',
  note: 'border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300',
  decision: 'border-amber-400/30 bg-amber-400/[0.06] text-amber-300',
  capture: 'border-white/10 bg-white/[0.04] text-white/60',
};

function fmtDayHeader(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: '180' });
      if (search) params.set('q', search);
      const res = await fetch(`/api/journal?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`journal fetch ${res.status}`);
      const body = (await res.json()) as { entries: Entry[] };
      setEntries(body.entries || []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchAll(q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, fetchAll]);

  const grouped = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = e.created_at.slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Journal</h1>
            <p className="mt-1 text-sm text-white/55">
              Everything you said that wasn&apos;t a task — thoughts, notes, decisions, captures. Searchable.
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 num">
            {entries.length} entries
          </div>
        </header>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search journal…"
          className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-emerald-400/40"
        />

        {err && (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {err}
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-8 text-center text-[12px] text-white/40">
            {q ? `No matches for "${q}"` : 'No journal entries yet. Speak something not-task-shaped via Telegram or the watch shortcut and it lands here.'}
          </div>
        )}

        <div className="space-y-5">
          {grouped.map(([day, dayEntries]) => (
            <section key={day}>
              <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
                {fmtDayHeader(day)} · {dayEntries.length}
              </h2>
              <ul className="space-y-1.5">
                {dayEntries.map((e) => {
                  const isOpen = expanded.has(e.id);
                  const kindTone = KIND_TONE[e.kind] || KIND_TONE.capture;
                  return (
                    <li
                      key={e.id}
                      onClick={() => toggle(e.id)}
                      className="cursor-pointer rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition hover:border-white/[0.12] hover:bg-white/[0.04]"
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${kindTone}`}>
                          {e.kind}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-white/90">{e.summary}</div>
                          {isOpen && e.raw_text !== e.summary && (
                            <div className="mt-2 whitespace-pre-wrap rounded border border-white/[0.06] bg-black/20 px-2.5 py-1.5 text-[12px] text-white/65">
                              {e.raw_text}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-white/30">
                            <span className="num">{fmtTime(e.created_at)}</span>
                            <span>· {e.source}</span>
                            {e.tags.length > 0 && (
                              <span className="text-emerald-300/60">
                                {e.tags.map((t) => `#${t}`).join(' ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Shell>
  );
}
