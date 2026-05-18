'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';
import { to12h } from '@/lib/format';

type DbBlock = {
  id: string;
  user_id: string;
  week_label: 'shared' | 'A' | 'B';
  day: number;
  start_time: string;
  end_time: string;
  name: string;
  type: 'deep-thinking' | 'deep-admin' | 'multitask-admin' | 'meeting' | 'coaching' | 'personal' | 'flex';
  energy: 'high' | 'med' | 'low' | null;
  locked: boolean;
  is_active: boolean;
};

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const TYPES: DbBlock['type'][] = ['deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'coaching', 'personal', 'flex'];
const ENERGIES = ['high', 'med', 'low'] as const;
const WEEK_LABELS: DbBlock['week_label'][] = ['shared', 'A', 'B'];

const TYPE_COLOR: Record<string, string> = {
  'deep-thinking': 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  'deep-admin': 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300',
  'multitask-admin': 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  'meeting': 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  'coaching': 'border-white/15 bg-white/[0.06] text-white/70',
  'personal': 'border-white/10 bg-white/[0.04] text-white/55',
  'flex': 'border-sky-400/30 bg-sky-400/10 text-sky-300',
};

type EditState = Partial<DbBlock> & { id: string };
type Preset = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  block_count: number;
  created_at: string;
};

export default function BlockTemplatesPage() {
  const [blocks, setBlocks] = useState<DbBlock[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [viewingPresetId, setViewingPresetId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<'all' | 'A' | 'B'>('all');
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/blocks/presets', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      const ps = (body.presets || []) as Preset[];
      setPresets(ps);
      // Default to viewing the active preset on first load
      if (!viewingPresetId) {
        const active = ps.find((p) => p.is_active);
        if (active) setViewingPresetId(active.id);
      }
    } catch {}
  }, [viewingPresetId]);

  const fetchBlocks = useCallback(async (presetId: string | null) => {
    try {
      const url = presetId ? `/api/blocks/template?preset=${presetId}` : '/api/blocks/template';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const body = await res.json();
      setBlocks(body.blocks as DbBlock[]);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  useEffect(() => {
    fetchBlocks(viewingPresetId);
  }, [fetchBlocks, viewingPresetId]);

  const viewingPreset = useMemo(() => presets.find((p) => p.id === viewingPresetId) || null, [presets, viewingPresetId]);
  const isViewingActive = viewingPreset?.is_active ?? false;

  const activatePreset = async (presetId: string) => {
    await fetch(`/api/blocks/presets/${presetId}/activate`, { method: 'POST' });
    await fetchPresets();
    await fetchBlocks(presetId);
  };

  const duplicatePreset = async () => {
    if (!viewingPresetId) return;
    const newName = prompt(`Name the new preset (e.g. "Summer ${new Date().getFullYear()}"):`, viewingPreset?.name ? `${viewingPreset.name} (copy)` : 'New preset');
    if (!newName?.trim()) return;
    const res = await fetch(`/api/blocks/presets/${viewingPresetId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const body = await res.json();
      await fetchPresets();
      setViewingPresetId(body.preset.id);
    }
  };

  const renamePreset = async () => {
    if (!viewingPreset) return;
    const newName = prompt('Rename preset:', viewingPreset.name);
    if (!newName?.trim() || newName.trim() === viewingPreset.name) return;
    await fetch(`/api/blocks/presets/${viewingPreset.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    await fetchPresets();
  };

  const deletePreset = async () => {
    if (!viewingPreset) return;
    if (viewingPreset.is_active) {
      alert('Activate a different preset first.');
      return;
    }
    if (!confirm(`Delete preset "${viewingPreset.name}" and all ${viewingPreset.block_count} of its blocks?`)) return;
    await fetch(`/api/blocks/presets/${viewingPreset.id}`, { method: 'DELETE' });
    setViewingPresetId(presets.find((p) => p.is_active)?.id || null);
    await fetchPresets();
  };

  const createBlankPreset = async () => {
    const name = prompt('Name for the new preset:', 'New schedule');
    if (!name?.trim()) return;
    const res = await fetch('/api/blocks/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const body = await res.json();
      await fetchPresets();
      setViewingPresetId(body.preset.id);
    }
  };

  const filteredBlocks = useMemo(() => {
    if (!blocks) return [];
    if (filter === 'all') return blocks;
    return blocks.filter((b) => b.week_label === 'shared' || b.week_label === filter);
  }, [blocks, filter]);

  const byDay = useMemo(() => {
    const map = new Map<number, DbBlock[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const b of filteredBlocks) {
      map.get(b.day)?.push(b);
    }
    return map;
  }, [filteredBlocks]);

  const startEdit = (b: DbBlock) => {
    setEdits((prev) => ({ ...prev, [b.id]: { ...b } }));
  };

  const cancelEdit = (id: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateEdit = <K extends keyof DbBlock>(id: string, k: K, v: DbBlock[K]) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
  };

  const saveEdit = async (id: string) => {
    const e = edits[id];
    if (!e) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/blocks/template/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: e.name,
          day: e.day,
          start_time: e.start_time,
          end_time: e.end_time,
          type: e.type,
          energy: e.energy,
          week_label: e.week_label,
          locked: e.locked,
        }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      await fetchBlocks(viewingPresetId);
      cancelEdit(id);
    } catch (err) {
      setErr((err as Error).message);
    }
    setSavingId(null);
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this block from your weekly template?')) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/blocks/template/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete ${res.status}`);
      await fetchBlocks(viewingPresetId);
    } catch (err) {
      setErr((err as Error).message);
    }
    setSavingId(null);
  };

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
              Settings // Block Template
            </h1>
            <p className="mt-1 text-sm text-white/60">
              Edit your weekly schedule. Changes apply to all future weeks immediately.
            </p>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            disabled={!viewingPresetId}
            className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {showAdd ? 'Cancel' : '+ New Block'}
          </button>
        </header>

        {/* Preset switcher — hidden by default for clean editor experience.
            Shows only when you have more than one preset. */}
        {presets.length > 1 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">Schedule presets</span>
              <button
                onClick={() => setShowPresetMenu((v) => !v)}
                className="text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white/70"
              >
                {showPresetMenu ? 'Hide' : 'Actions'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => {
                const viewing = p.id === viewingPresetId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setViewingPresetId(p.id)}
                    className={`group flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                      viewing
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-white'
                        : 'border-white/10 bg-black/30 text-white/60 hover:border-white/20 hover:text-white/85'
                    }`}
                  >
                    {p.is_active && <span className="text-emerald-300">●</span>}
                    <span>{p.name}</span>
                    <span className="num text-[10px] text-white/40">{p.block_count}b</span>
                  </button>
                );
              })}
              <button
                onClick={createBlankPreset}
                className="rounded-md border border-dashed border-white/15 px-3 py-2 text-sm text-white/40 hover:border-white/30 hover:text-white/70"
              >
                + Blank preset
              </button>
            </div>

            {viewingPreset && showPresetMenu && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3 text-[11px]">
                {!isViewingActive && (
                  <button
                    onClick={() => activatePreset(viewingPreset.id)}
                    className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-emerald-300 hover:bg-emerald-400/25"
                  >
                    ● Activate
                  </button>
                )}
                <button
                  onClick={duplicatePreset}
                  className="min-h-9 rounded-md border border-white/10 px-3 py-1.5 text-white/70 hover:bg-white/[0.04]"
                >
                  Duplicate as new
                </button>
                <button
                  onClick={renamePreset}
                  className="min-h-9 rounded-md border border-white/10 px-3 py-1.5 text-white/70 hover:bg-white/[0.04]"
                >
                  Rename
                </button>
                <button
                  onClick={deletePreset}
                  disabled={isViewingActive}
                  className="min-h-9 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-red-300 hover:bg-red-400/20 disabled:opacity-40"
                  title={isViewingActive ? 'Activate a different preset first' : undefined}
                >
                  Delete
                </button>
              </div>
            )}

            {viewingPreset && (
              <div className="mt-2 text-[11px] text-white/40">
                Viewing <span className="text-white/70">{viewingPreset.name}</span>
                {isViewingActive ? ' · live schedule' : ' · draft (not active)'}
              </div>
            )}
          </div>
        )}

        {err && <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">⚠ {err}</div>}

        {showAdd && <NewBlockForm presetId={viewingPresetId} onCreated={() => { setShowAdd(false); fetchBlocks(viewingPresetId); }} />}

        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
          <span>View:</span>
          {(['all', 'A', 'B'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 transition ${
                filter === f ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
              }`}
            >
              {f === 'all' ? 'All' : `Week ${f}`}
            </button>
          ))}
          <span className="ml-auto">
            {filteredBlocks.length} block{filteredBlocks.length === 1 ? '' : 's'}
          </span>
        </div>

        {blocks === null && <p className="text-sm text-white/40">Loading…</p>}
        {blocks !== null && blocks.length === 0 && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-300">
            ⚠ No blocks in the database. The system is falling back to the original hardcoded template.
            Run migration <code className="rounded bg-black/40 px-1.5 py-0.5">supabase/migrations/0002_block_templates.sql</code> in the Supabase SQL Editor to enable editing.
          </div>
        )}

        {DISPLAY_ORDER.map((day) => {
          const dayBlocks = byDay.get(day) || [];
          if (dayBlocks.length === 0) return null;
          return (
            <section key={day}>
              <h2 className="mb-2 text-xs uppercase tracking-[0.18em] text-white/50">
                {DAY_LABELS[day]} <span className="ml-2 text-white/30">{dayBlocks.length}</span>
              </h2>
              <div className="space-y-1">
                {dayBlocks.map((b) => {
                  const e = edits[b.id];
                  const editing = !!e;
                  if (!editing) {
                    return (
                      <div
                        key={b.id}
                        onClick={() => startEdit(b)}
                        className="group flex cursor-pointer items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition hover:border-white/[0.12] hover:bg-white/[0.04]"
                      >
                        <span className="num shrink-0 text-[11px] text-white/40">
                          {to12h(b.start_time)}–{to12h(b.end_time)}
                        </span>
                        <span className="flex-1 truncate text-sm text-white/85">
                          {b.locked && '🔒 '}{b.name}
                        </span>
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] tracking-[0.18em] ${TYPE_COLOR[b.type]}`}>
                          {b.type.toUpperCase().replace('-', ' ')}
                        </span>
                        {b.week_label !== 'shared' && (
                          <span className="shrink-0 rounded border border-purple-400/30 bg-purple-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-purple-300">
                            Week {b.week_label}
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={b.id} className="space-y-2 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="block">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Day</div>
                          <select
                            value={e.day ?? b.day}
                            onChange={(ev) => updateEdit(b.id, 'day', Number(ev.target.value))}
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
                          >
                            {DISPLAY_ORDER.map((d) => (
                              <option key={d} value={d}>{DAY_LABELS[d]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Week</div>
                          <select
                            value={e.week_label || b.week_label}
                            onChange={(ev) => updateEdit(b.id, 'week_label', ev.target.value as DbBlock['week_label'])}
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
                          >
                            {WEEK_LABELS.map((w) => (
                              <option key={w} value={w}>{w === 'shared' ? 'Both (A+B)' : `Week ${w} only`}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Start</div>
                          <input
                            type="time"
                            value={e.start_time || b.start_time}
                            onChange={(ev) => updateEdit(b.id, 'start_time', ev.target.value)}
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">End</div>
                          <input
                            type="time"
                            value={e.end_time || b.end_time}
                            onChange={(ev) => updateEdit(b.id, 'end_time', ev.target.value)}
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Name</div>
                        <input
                          value={e.name ?? b.name}
                          onChange={(ev) => updateEdit(b.id, 'name', ev.target.value)}
                          className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none"
                        />
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="block">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Type</div>
                          <select
                            value={e.type || b.type}
                            onChange={(ev) => updateEdit(b.id, 'type', ev.target.value as DbBlock['type'])}
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
                          >
                            {TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Energy</div>
                          <select
                            value={(e.energy ?? b.energy) || ''}
                            onChange={(ev) => updateEdit(b.id, 'energy', (ev.target.value || null) as DbBlock['energy'])}
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none"
                          >
                            <option value="">— none —</option>
                            {ENERGIES.map((en) => (
                              <option key={en} value={en}>{en}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/80">
                          <input
                            type="checkbox"
                            checked={e.locked ?? b.locked}
                            onChange={(ev) => updateEdit(b.id, 'locked', ev.target.checked)}
                            className="size-4 accent-emerald-400"
                          />
                          🔒 Locked (no tasks)
                        </label>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <button
                          onClick={() => remove(b.id)}
                          disabled={savingId === b.id}
                          className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/20"
                        >
                          Delete
                        </button>
                        <div className="flex gap-2">
                          <button
                            onClick={() => cancelEdit(b.id)}
                            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/[0.04]"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(b.id)}
                            disabled={savingId === b.id}
                            className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-400/25"
                          >
                            {savingId === b.id ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function NewBlockForm({ presetId, onCreated }: { presetId: string | null; onCreated: () => void }) {
  const [day, setDay] = useState(1);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [name, setName] = useState('');
  const [type, setType] = useState<DbBlock['type']>('deep-admin');
  const [energy, setEnergy] = useState<DbBlock['energy']>('med');
  const [locked, setLocked] = useState(false);
  const [weekLabel, setWeekLabel] = useState<DbBlock['week_label']>('shared');
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/blocks/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day,
          start_time: start,
          end_time: end,
          name: name.trim(),
          type,
          energy,
          locked,
          week_label: weekLabel,
          preset_id: presetId,
        }),
      });
      if (res.ok) {
        setName('');
        onCreated();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Day</div>
          <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none">
            {DISPLAY_ORDER.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Week</div>
          <select value={weekLabel} onChange={(e) => setWeekLabel(e.target.value as DbBlock['week_label'])} className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none">
            {WEEK_LABELS.map((w) => <option key={w} value={w}>{w === 'shared' ? 'Both' : `Week ${w}`}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">Start</div>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none" />
        </label>
        <label className="block">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/40">End</div>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none" />
        </label>
      </div>
      <input placeholder="Block name (e.g. Marcus session)" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none" />
      <div className="grid grid-cols-3 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as DbBlock['type'])} className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none">
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={energy || ''} onChange={(e) => setEnergy((e.target.value || null) as DbBlock['energy'])} className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/90 outline-none">
          <option value="">no energy</option>
          {ENERGIES.map((en) => <option key={en} value={en}>{en}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} className="size-4 accent-emerald-400" />
          🔒 Locked
        </label>
      </div>
      <button type="submit" disabled={!name.trim() || pending} className="w-full rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40">
        {pending ? 'Adding…' : 'Add Block'}
      </button>
    </form>
  );
}
