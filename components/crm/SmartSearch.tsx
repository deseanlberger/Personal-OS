'use client';

import { useState } from 'react';

export function SmartSearch({
  onResult,
  onClear,
}: {
  onResult: (taskIds: string[], rationale: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [rationale, setRationale] = useState<string | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setPending(true);
    try {
      const res = await fetch('/api/tasks/smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const body = await res.json();
      const ids: string[] = body.task_ids || [];
      setRationale(body.rationale || null);
      onResult(ids, body.rationale || '');
    } catch (err) {
      setRationale(`Error: ${(err as Error).message}`);
    }
    setPending(false);
  }

  function clear() {
    setQuery('');
    setRationale(null);
    onClear();
  }

  return (
    <form onSubmit={go} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
        <span className="text-white/30">⌥</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Ask Claude: "what should I do this morning"…'
          className="flex-1 bg-transparent text-sm text-white/80 outline-none placeholder-white/30"
        />
        {rationale && (
          <button
            type="button"
            onClick={clear}
            className="text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white/70"
          >
            Clear
          </button>
        )}
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="min-h-9 rounded-md border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/60 hover:bg-white/[0.04] disabled:opacity-40"
        >
          {pending ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {rationale && (
        <div className="px-1 text-[11px] italic text-white/40">
          {rationale}
        </div>
      )}
    </form>
  );
}
