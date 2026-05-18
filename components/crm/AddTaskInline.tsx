'use client';

import { useState } from 'react';
import { EVENTS, emit } from '@/lib/events';
import type { Urgency } from '@/lib/types';

const URGENCIES: { value: Urgency; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'Week' },
  { value: 'this_month', label: 'Month' },
  { value: 'someday', label: 'Someday' },
];

export function AddTaskInline() {
  const [title, setTitle] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('this_week');
  const [pending, setPending] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), urgency }),
      });
      if (res.ok) {
        setTitle('');
        emit(EVENTS.TASK_CHANGED);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={add}
      className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2"
    >
      <span className="text-white/30">+</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task quickly (use Jarvis for AI classification)"
        className="flex-1 bg-transparent text-sm text-white/80 outline-none placeholder-white/30"
      />
      <select
        value={urgency}
        onChange={(e) => setUrgency(e.target.value as Urgency)}
        className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/60 outline-none"
      >
        {URGENCIES.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
      >
        {pending ? '…' : 'Add'}
      </button>
    </form>
  );
}
