'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/dashboard/Shell';

type Match = {
  id: string;
  source_type: string;
  source_id: string;
  text: string;
  similarity: number;
  created_at: string;
};

type Mode = 'ask' | 'search';

const SOURCE_LINK: Record<string, (id: string) => string | null> = {
  task: (id) => `/crm?task=${id}`,
  capture: () => null,
  decision: (id) => `/crm?task=${id}`,
  journal: () => null,
  habit: () => null,
  meal: () => null,
  goal: () => null,
  note: () => null,
};

export default function BrainPage() {
  const [mode, setMode] = useState<Mode>('ask');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || pending) return;
    setPending(true);
    setError(null);
    setAnswer(null);
    setMatches([]);

    try {
      if (mode === 'ask') {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: query.trim() }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setAnswer(body.answer);
        setMatches(body.sources || []);
      } else {
        const res = await fetch('/api/memory/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query.trim() }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setMatches(body.matches || []);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setPending(false);
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Brain</h1>
          <p className="mt-1 text-sm text-white/55">
            Semantic search across every capture, task, journal, decision, meal, and habit you&apos;ve ever logged.
          </p>
        </header>

        <div className="flex w-fit items-center rounded-md border border-white/10 bg-black/30 p-0.5">
          {(['ask', 'search'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
                mode === m
                  ? 'bg-emerald-400/20 text-emerald-300'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'ask' ? 'Ask anything — "what was that gym idea from March"' : 'Search captures…'}
            className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-emerald-400/40"
          />
          <button
            type="submit"
            disabled={!query.trim() || pending}
            className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {pending ? '…' : mode}
          </button>
        </form>

        {error && (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {answer && (
          <article className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">Answer</div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{answer}</div>
          </article>
        )}

        {matches.length > 0 && (
          <section>
            <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">
              {answer ? 'Sources' : 'Matches'} · {matches.length}
            </h2>
            <ul className="space-y-1">
              {matches.map((m) => {
                const link = SOURCE_LINK[m.source_type]?.(m.source_id);
                const Body = (
                  <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition hover:border-white/[0.12] hover:bg-white/[0.04]">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-white/40">
                      <span>
                        <span className="font-mono text-white/30">[{m.id.slice(0, 8)}]</span>
                        <span className="ml-2">{m.source_type}</span>
                      </span>
                      <span className="num">{(m.similarity * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 text-sm text-white/85">{m.text}</div>
                    <div className="num mt-0.5 text-[10px] text-white/30">{m.created_at.slice(0, 10)}</div>
                  </div>
                );
                return (
                  <li key={m.id}>
                    {link ? <Link href={link}>{Body}</Link> : Body}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!pending && !error && !answer && matches.length === 0 && (
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-6 text-center text-[12px] text-white/40">
            Type a question above. Examples:
            <div className="mt-2 space-y-1 text-white/55">
              <div>&quot;what athletes have I logged this week&quot;</div>
              <div>&quot;what did I decide about Atlas&quot;</div>
              <div>&quot;every deep-thinking task involving marketing&quot;</div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
