'use client';

import { useEffect, useState } from 'react';
import type { Task, Urgency, Category, Energy } from '@/lib/types';

const URGENCIES: Urgency[] = ['today', 'this_week', 'this_month', 'someday'];
const CATEGORIES: Category[] = ['deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'personal', 'flex'];
const ENERGIES: Energy[] = ['high', 'med', 'low'];

export function TaskDrawer({
  task,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [local, setLocal] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocal(task);
  }, [task]);

  if (!open || !local) return null;

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setLocal((prev) => (prev ? { ...prev, [k]: v } : prev));

  const save = async () => {
    if (!local) return;
    setSaving(true);
    await onSave(local.id, {
      title: local.title,
      description: local.description,
      urgency: local.urgency,
      key: local.key,
      category: local.category,
      energy: local.energy,
      estimated_minutes: local.estimated_minutes,
      tags: local.tags,
      due_date: local.due_date,
    });
    setSaving(false);
    onClose();
  };

  const remove = async () => {
    if (!local) return;
    if (!confirm('Delete this task?')) return;
    setSaving(true);
    await onDelete(local.id);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        onClick={onClose}
        className="flex-1 bg-black/60 backdrop-blur-sm"
        aria-label="Close drawer"
      />
      <div className="flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[color:var(--ink-0)] p-6">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Edit task</div>
          <button onClick={onClose} className="text-white/50 hover:text-white/80">✕</button>
        </div>

        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Title</div>
          <input
            value={local.title}
            onChange={(e) => set('title', e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
          />
        </label>

        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Description</div>
          <textarea
            value={local.description || ''}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Urgency</div>
            <select
              value={local.urgency}
              onChange={(e) => set('urgency', e.target.value as Urgency)}
              className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
            >
              {URGENCIES.map((u) => (
                <option key={u} value={u}>{u.replace('_', ' ')}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={local.key}
              onChange={(e) => set('key', e.target.checked)}
              className="size-4 accent-emerald-400"
            />
            <span className="text-sm text-white/80">★ Key blocker</span>
          </label>

          <label className="block">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Category</div>
            <select
              value={local.category || ''}
              onChange={(e) => set('category', (e.target.value || null) as Category | null)}
              className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
            >
              <option value="">— none —</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Energy</div>
            <select
              value={local.energy || ''}
              onChange={(e) => set('energy', (e.target.value || null) as Energy | null)}
              className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
            >
              <option value="">— none —</option>
              {ENERGIES.map((en) => (
                <option key={en} value={en}>{en}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Estimated min</div>
            <input
              type="number"
              min={5}
              max={240}
              value={local.estimated_minutes ?? ''}
              onChange={(e) => set('estimated_minutes', e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Due</div>
            <input
              type="date"
              value={local.due_date || ''}
              onChange={(e) => set('due_date', e.target.value || null)}
              className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
            />
          </label>
        </div>

        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Tags (comma separated)</div>
          <input
            value={local.tags.join(', ')}
            onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            placeholder="tri-city, programming"
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/40"
          />
        </label>

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            onClick={remove}
            disabled={saving}
            className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300 hover:bg-red-400/20"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/[0.04]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-400/25"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
