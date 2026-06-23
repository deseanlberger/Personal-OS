'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

type Exercise = { canonical_name: string; movement_pattern: string };
type StrengthSet = {
  id: string;
  set_number: number;
  weight: number;
  reps: number;
  rpe: number | null;
  exercise_id: string;
  exercises: Exercise;
};
type RunningSession = {
  run_type: string;
  distance_m: number;
  duration_s: number;
  avg_pace_s_per_mi: number | null;
};
type WorkoutSession = {
  id: string;
  session_date: string;
  session_type: 'strength' | 'running';
  category: string;
  calendar_block_id: string | null;
  notes: string | null;
  needs_review: boolean;
  strength_sets?: StrengthSet[];
  running_sessions?: RunningSession | null;
};

type Pending = {
  raw_capture_id: string;
  raw_text: string;
  created_at: string;
  alias: string;
  sets: { weight: number; reps: number; rpe: number | null }[];
  notes: string | null;
};

const METERS_PER_MILE = 1609.344;

function fmtPace(s: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const ss = String(Math.round(s % 60)).padStart(2, '0');
  return `${m}:${ss}/mi`;
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function groupStrengthSetsByExercise(sets: StrengthSet[]): Map<string, StrengthSet[]> {
  const map = new Map<string, StrengthSet[]>();
  for (const s of sets.sort((a, b) => a.set_number - b.set_number)) {
    const key = s.exercises?.canonical_name || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

export default function WorkoutPage() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/workout/sessions?days=90', { cache: 'no-store' }),
        fetch('/api/workout/pending', { cache: 'no-store' }),
      ]);
      if (sRes.ok) {
        const b = await sRes.json();
        setSessions(b.sessions || []);
      }
      if (pRes.ok) {
        const b = await pRes.json();
        setPending(b.items || []);
      }
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const byMonth = sessions.reduce<Record<string, WorkoutSession[]>>((acc, s) => {
    const m = s.session_date.slice(0, 7);
    (acc[m] = acc[m] || []).push(s);
    return acc;
  }, {});
  const months = Object.keys(byMonth).sort().reverse();

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Workout</h1>
          <p className="mt-1 text-sm text-white/60">
            Strength + running log. Capture via Telegram (&quot;bench 225 by 5 by 5&quot;) or iOS Shortcut.
          </p>
        </header>

        {err && <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">⚠ {err}</div>}

        {pending.length > 0 && (
          <PendingSection pending={pending} onResolved={fetchAll} />
        )}

        {sessions.length === 0 && pending.length === 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-[12px] text-white/40">
            No workouts logged yet. Text Jarvis &quot;bench 225 by 5 by 5&quot; on Telegram to log your first session.
          </div>
        )}

        {months.map((month) => (
          <section key={month}>
            <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">
              {new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="space-y-2">
              {byMonth[month].map((s) => <SessionCard key={s.id} session={s} />)}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}

function SessionCard({ session }: { session: WorkoutSession }) {
  const date = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (session.session_type === 'running' && session.running_sessions) {
    const r = session.running_sessions;
    const mi = Number(r.distance_m) / METERS_PER_MILE;
    return (
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium text-white/90">🏃 {r.run_type.charAt(0).toUpperCase() + r.run_type.slice(1)} run</div>
          <div className="num text-[10px] uppercase tracking-[0.18em] text-white/40">{date}</div>
        </div>
        <div className="num mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-white/75">
          <span>{mi.toFixed(2)} mi</span>
          <span>{fmtDuration(r.duration_s)}</span>
          <span>{fmtPace(r.avg_pace_s_per_mi)}</span>
        </div>
        {session.notes && <div className="mt-1 text-[11px] italic text-white/45">{session.notes}</div>}
      </div>
    );
  }

  if (session.session_type === 'strength' && session.strength_sets?.length) {
    const groups = groupStrengthSetsByExercise(session.strength_sets);
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium text-white/90">🏋️ Strength</div>
          <div className="num text-[10px] uppercase tracking-[0.18em] text-white/40">{date}</div>
        </div>
        <ul className="mt-2 space-y-1.5">
          {Array.from(groups.entries()).map(([name, sets]) => {
            const allSame = sets.every((x) => x.weight === sets[0].weight && x.reps === sets[0].reps);
            const summary = allSame
              ? `${sets[0].weight}×${sets[0].reps}×${sets.length}`
              : sets.map((x) => `${x.weight}×${x.reps}`).join(', ');
            return (
              <li key={name} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-white/85">{name}</span>
                <span className="num text-white/70">{summary}</span>
              </li>
            );
          })}
        </ul>
        {session.notes && <div className="mt-2 text-[11px] italic text-white/45">{session.notes}</div>}
      </div>
    );
  }

  return null;
}

function PendingSection({ pending, onResolved }: { pending: Pending[]; onResolved: () => Promise<void> | void }) {
  return (
    <section>
      <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-amber-300/85">
        Pending Review · {pending.length}
      </h2>
      <div className="space-y-2">
        {pending.map((p) => <PendingRow key={p.raw_capture_id} item={p} onResolved={onResolved} />)}
      </div>
    </section>
  );
}

function PendingRow({ item, onResolved }: { item: Pending; onResolved: () => Promise<void> | void }) {
  const [mode, setMode] = useState<'idle' | 'merge' | 'create'>('idle');
  const [exercises, setExercises] = useState<{ id: string; canonical_name: string }[]>([]);
  const [mergeId, setMergeId] = useState('');
  const [newName, setNewName] = useState(item.alias);
  const [newPattern, setNewPattern] = useState('horizontal_press');
  const [newGroup, setNewGroup] = useState('chest');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'merge') return;
    fetch('/api/workout/sessions?days=180', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b: { sessions?: WorkoutSession[] }) => {
        const seen = new Set<string>();
        const list: { id: string; canonical_name: string }[] = [];
        for (const s of b.sessions || []) {
          for (const ss of s.strength_sets || []) {
            if (!seen.has(ss.exercise_id)) {
              seen.add(ss.exercise_id);
              list.push({ id: ss.exercise_id, canonical_name: ss.exercises?.canonical_name || '' });
            }
          }
        }
        setExercises(list);
      })
      .catch(() => {});
  }, [mode]);

  const submit = async (action: 'merge' | 'create') => {
    setBusy(true);
    const body = action === 'merge'
      ? { raw_capture_id: item.raw_capture_id, action: 'merge', exercise_id: mergeId }
      : { raw_capture_id: item.raw_capture_id, action: 'create', new_exercise: { canonical_name: newName, movement_pattern: newPattern, muscle_group: newGroup, aliases: [item.alias] } };
    await fetch('/api/workout/pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setBusy(false);
    await onResolved();
  };

  const allSame = item.sets.every((s) => s.weight === item.sets[0].weight && s.reps === item.sets[0].reps);
  const summary = allSame
    ? `${item.sets[0].weight}×${item.sets[0].reps}×${item.sets.length}`
    : item.sets.map((s) => `${s.weight}×${s.reps}`).join(', ');

  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.05] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm text-white/90">
          &ldquo;<span className="text-amber-300">{item.alias}</span>&rdquo; — {summary}
        </div>
        <div className="text-[10px] text-white/40">{item.raw_text}</div>
      </div>
      {mode === 'idle' && (
        <div className="mt-2 flex gap-2">
          <button onClick={() => setMode('merge')} className="rounded-md border border-white/15 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/75 hover:bg-white/[0.05]">
            Merge into existing
          </button>
          <button onClick={() => setMode('create')} className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25">
            Create new exercise
          </button>
        </div>
      )}
      {mode === 'merge' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={mergeId} onChange={(e) => setMergeId(e.target.value)} className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none">
            <option value="">— pick exercise —</option>
            {exercises.map((e) => <option key={e.id} value={e.id}>{e.canonical_name}</option>)}
          </select>
          <button onClick={() => submit('merge')} disabled={!mergeId || busy} className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-300 disabled:opacity-40">
            {busy ? '…' : 'Merge'}
          </button>
          <button onClick={() => setMode('idle')} className="text-[11px] text-white/40 hover:text-white/70">Cancel</button>
        </div>
      )}
      {mode === 'create' && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Canonical name" className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none" />
          <select value={newPattern} onChange={(e) => setNewPattern(e.target.value)} className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none">
            {['horizontal_press','vertical_press','horizontal_pull','vertical_pull','squat','hinge','lunge','carry','core','arms','accessory'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none">
            {['chest','back','shoulders','biceps','triceps','quads','hamstrings','glutes','calves','core','full_body','arms'].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => submit('create')} disabled={!newName || busy} className="flex-1 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-300 disabled:opacity-40">
              {busy ? '…' : 'Create'}
            </button>
            <button onClick={() => setMode('idle')} className="text-[11px] text-white/40 hover:text-white/70">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
