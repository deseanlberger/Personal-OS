'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

type Link = {
  id: string;
  url: string;
  domain: string | null;
  source_kind: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  summary: string | null;
  category: string | null;
  tags: string[];
  created_at: string;
};

const KIND_GLYPH: Record<string, string> = {
  youtube: '▶',
  instagram: '◉',
  twitter: '𝕏',
  tiktok: '♪',
  article: '📄',
  other: '🔗',
};

const CATEGORY_TONE: Record<string, string> = {
  training: 'border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300',
  programming: 'border-blue-400/30 bg-blue-400/[0.06] text-blue-300',
  business: 'border-amber-400/30 bg-amber-400/[0.06] text-amber-300',
  marketing: 'border-orange-400/30 bg-orange-400/[0.06] text-orange-300',
  finance: 'border-yellow-400/30 bg-yellow-400/[0.06] text-yellow-300',
  athletes: 'border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300',
  recipes: 'border-amber-400/30 bg-amber-400/[0.06] text-amber-300',
  tech: 'border-sky-400/30 bg-sky-400/[0.06] text-sky-300',
  education: 'border-purple-400/30 bg-purple-400/[0.06] text-purple-300',
  personal: 'border-white/15 bg-white/[0.04] text-white/65',
  other: 'border-white/10 bg-white/[0.02] text-white/45',
  uncategorized: 'border-white/10 bg-white/[0.02] text-white/45',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export default function LibraryPage() {
  const [links, setLinks] = useState<Link[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      const res = await fetch(`/api/links?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`links ${res.status}`);
      const body = (await res.json()) as { links: Link[] };
      setLinks(body.links || []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [q, category]);

  useEffect(() => {
    const t = setTimeout(fetchAll, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchAll, q]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingUrl.trim() || pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: addingUrl.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setAddingUrl('');
      await fetchAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this link?')) return;
    await fetch(`/api/links/${id}`, { method: 'DELETE' });
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const l of links) if (l.category) set.add(l.category);
    return Array.from(set).sort();
  }, [links]);

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Library</h1>
          <p className="mt-1 text-sm text-white/55">
            Every URL you saved — auto-classified, searchable, embedded into /brain.
            Share a link with the Telegram bot or paste one here.
          </p>
        </header>

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={addingUrl}
            onChange={(e) => setAddingUrl(e.target.value)}
            placeholder="Paste a URL — YouTube, Instagram, article, anything…"
            className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-emerald-400/40"
          />
          <button
            type="submit"
            disabled={!addingUrl.trim() || pending}
            className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search saved links…"
          className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/30"
        />

        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setCategory(null)}
              className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition ${
                category === null ? 'bg-emerald-400/20 text-emerald-300' : 'text-white/40 hover:text-white/70'
              }`}
            >
              all
            </button>
            {categories.map((c) => {
              const active = c === category;
              const tone = CATEGORY_TONE[c] || CATEGORY_TONE.other;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(active ? null : c)}
                  className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition ${
                    active ? tone : 'border-white/10 text-white/40 hover:text-white/70'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}

        {err && (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{err}</div>
        )}

        {links.length === 0 && !err && (
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-8 text-center text-[12px] text-white/40">
            {q || category ? 'No matches.' : 'Drop a link in Telegram or paste one above.'}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {links.map((l) => {
            const tone = CATEGORY_TONE[l.category || 'other'] || CATEGORY_TONE.other;
            return (
              <article
                key={l.id}
                className="group flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-white/[0.12] hover:bg-white/[0.04]"
              >
                <a href={l.url} target="_blank" rel="noreferrer" className="block">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                      <span className="mr-1">{KIND_GLYPH[l.source_kind] || '🔗'}</span>
                      {l.domain || l.source_kind}
                    </div>
                    <div className="num text-[10px] text-white/30">{fmtDate(l.created_at)}</div>
                  </div>
                  <h3 className="mt-1 text-sm font-medium text-white/90 line-clamp-2">
                    {l.title || l.url}
                  </h3>
                  {l.summary && l.summary !== l.title && (
                    <p className="mt-1 text-[12px] text-white/55 line-clamp-3">{l.summary}</p>
                  )}
                </a>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {l.category && (
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${tone}`}>
                      {l.category}
                    </span>
                  )}
                  {l.tags.slice(0, 4).map((t) => (
                    <span key={t} className="text-[10px] text-emerald-300/55">
                      #{t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => remove(l.id)}
                  className="self-end pt-1 text-[10px] text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-red-400/80"
                >
                  delete
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
