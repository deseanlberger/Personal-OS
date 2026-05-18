'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EVENTS, emit, onEvent } from '@/lib/events';
import type { Task, Urgency } from '@/lib/types';
import { TaskCard } from './TaskCard';
import { TaskDrawer } from './TaskDrawer';

const COLUMNS: { urgency: Urgency; label: string }[] = [
  { urgency: 'today', label: 'Today' },
  { urgency: 'this_week', label: 'This Week' },
  { urgency: 'this_month', label: 'This Month' },
  { urgency: 'someday', label: 'Someday' },
];

export function TasksKanban({ filterIds }: { filterIds?: Set<string> | null }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Per cheat sheet Bug 8.4: ignore mount-time GET if user has already mutated
  const dirtyRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?status=open&limit=500', { cache: 'no-store' });
      if (!res.ok) throw new Error(`tasks fetch ${res.status}`);
      const body = await res.json();
      if (dirtyRef.current) return; // user already changed something — don't clobber
      setTasks(body.tasks as Task[]);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    return onEvent(EVENTS.TASK_CHANGED, () => {
      dirtyRef.current = false;
      fetchTasks();
    });
  }, [fetchTasks]);

  const grouped = useMemo(() => {
    const map = new Map<Urgency, Task[]>();
    for (const c of COLUMNS) map.set(c.urgency, []);
    if (!tasks) return map;
    const list = filterIds ? tasks.filter((t) => filterIds.has(t.id)) : tasks;
    for (const t of list) {
      const col = map.get(t.urgency);
      if (col) col.push(t);
    }
    // Sort each column: pinned first, key second, then by momentum + created
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        if (a.key !== b.key) return a.key ? -1 : 1;
        const ms = b.momentum_score - a.momentum_score;
        if (ms !== 0) return ms;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    return map;
  }, [tasks, filterIds]);

  const openTask = useCallback((task: Task) => {
    setSelected(task);
    setDrawerOpen(true);
  }, []);

  const toggleDone = useCallback(async (task: Task, done: boolean) => {
    dirtyRef.current = true;
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === task.id ? { ...t, completed_at: done ? new Date().toISOString() : null } : t)) : prev,
    );
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed_at: done ? new Date().toISOString() : null }),
    });
    emit(EVENTS.TASK_CHANGED);
    // Drop dirty after sync so future event-bus refreshes work
    setTimeout(() => { dirtyRef.current = false; }, 300);
  }, []);

  const saveTask = useCallback(async (id: string, patch: Partial<Task>) => {
    dirtyRef.current = true;
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    emit(EVENTS.TASK_CHANGED);
    setTimeout(() => { dirtyRef.current = false; }, 300);
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    dirtyRef.current = true;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    setTasks((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    emit(EVENTS.TASK_CHANGED);
    setTimeout(() => { dirtyRef.current = false; }, 300);
  }, []);

  if (err) return <p className="p-4 text-sm text-red-400/80">⚠ {err}</p>;
  if (tasks === null) return <p className="p-4 text-sm text-white/40">Loading…</p>;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = grouped.get(col.urgency) || [];
          return (
            <div key={col.urgency} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between border-b border-white/[0.06] pb-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">
                  {col.label}
                </span>
                <span className="num text-[10px] text-white/40">{list.length}</span>
              </div>
              <div className="flex flex-col gap-2 pb-2">
                {list.length === 0 && (
                  <p className="rounded-md border border-dashed border-white/[0.06] p-3 text-[11px] text-white/30">
                    —
                  </p>
                )}
                {list.map((t) => (
                  <TaskCard key={t.id} task={t} onClick={openTask} onToggleDone={toggleDone} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <TaskDrawer
        task={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSave={saveTask}
        onDelete={deleteTask}
      />
    </>
  );
}
