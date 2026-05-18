'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type GoalItem = {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
  completed_at?: string | null;
};

type Scope = 'week' | 'month';
type GoalsResp = { week: GoalItem[]; month: GoalItem[] };

export function GoalsCard() {
  const [week, setWeek] = useState<GoalItem[]>([]);
  const [month, setMonth] = useState<GoalItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const dirtyRef = useRef(false);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch('/api/goals', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as GoalsResp;
      if (dirtyRef.current) return;
      setWeek(body.week || []);
      setMonth(body.month || []);
    } catch {}
    finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const apply = useCallback(
    async (scope: Scope, action: string, payload: Record<string, unknown> = {}) => {
      dirtyRef.current = true;
      try {
        const res = await fetch('/api/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, action, ...payload }),
        });
        if (res.ok) {
          const body = (await res.json()) as GoalsResp;
          setWeek(body.week || []);
          setMonth(body.month || []);
        }
      } finally {
        setTimeout(() => { dirtyRef.current = false; }, 300);
      }
    },
    [],
  );

  return (
    <div className="space-y-4">
      <GoalsSection
        title="This Week"
        items={week}
        hydrated={hydrated}
        onAdd={(text) => apply('week', 'add', { text })}
        onToggle={(id) => apply('week', 'toggle', { id })}
        onRemove={(id) => apply('week', 'remove', { id })}
        onClearDone={() => apply('week', 'clear_done')}
      />
      <GoalsSection
        title="This Month"
        items={month}
        hydrated={hydrated}
        onAdd={(text) => apply('month', 'add', { text })}
        onToggle={(id) => apply('month', 'toggle', { id })}
        onRemove={(id) => apply('month', 'remove', { id })}
        onClearDone={() => apply('month', 'clear_done')}
      />
    </div>
  );
}

function GoalsSection({
  title,
  items,
  hydrated,
  onAdd,
  onToggle,
  onRemove,
  onClearDone,
}: {
  title: string;
  items: GoalItem[];
  hydrated: boolean;
  onAdd: (text: string) => Promise<void> | void;
  onToggle: (id: string) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
  onClearDone: () => Promise<void> | void;
}) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const doneCount = items.filter((g) => g.done).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setPending(true);
    await onAdd(text);
    setInput('');
    setPending(false);
  };

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-white/[0.06] pb-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">{title}</span>
        <div className="flex items-baseline gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
          <span className="num">{items.length - doneCount} / {items.length}</span>
          {doneCount > 0 && (
            <button
              onClick={() => onClearDone()}
              className="text-white/40 hover:text-white/70"
            >
              clear done
            </button>
          )}
        </div>
      </div>

      <ul className="mt-2 flex flex-col">
        {!hydrated && items.length === 0 && (
          <li className="py-1.5 text-[11px] text-white/40">Loading…</li>
        )}
        {hydrated && items.length === 0 && (
          <li className="py-1.5 text-[11px] text-white/40">Nothing yet.</li>
        )}
        {items.map((g) => (
          <li key={g.id} className="group flex items-start gap-2 py-1.5">
            <button
              onClick={() => onToggle(g.id)}
              className={`mt-0.5 size-4 shrink-0 rounded border transition ${
                g.done
                  ? 'border-emerald-400/60 bg-emerald-400/30'
                  : 'border-white/20 hover:border-emerald-400/40 hover:bg-emerald-400/10'
              }`}
              aria-label={g.done ? 'Mark not done' : 'Mark done'}
            >
              {g.done && <span className="block text-center text-[10px] leading-none text-emerald-200">✓</span>}
            </button>
            <span className={`flex-1 text-sm leading-tight ${g.done ? 'text-white/40 line-through' : 'text-white/85'}`}>
              {g.text}
            </span>
            <button
              onClick={() => onRemove(g.id)}
              className="shrink-0 text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-red-400/80"
              aria-label="Remove goal"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="mt-2 flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-1.5">
        <span className="text-white/30">+</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Add a ${title.toLowerCase().replace('this ', '')} goal`}
          className="flex-1 bg-transparent text-sm text-white/80 outline-none placeholder-white/30"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="min-h-7 rounded border border-white/10 px-2 text-[10px] uppercase tracking-[0.18em] text-white/60 hover:bg-white/[0.04] disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </section>
  );
}
