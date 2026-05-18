'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localDateKey } from '@/lib/habits/date';
import { DAILY_TARGETS } from '@/lib/nutrition/targets';

type Meal = {
  id: string;
  t: string;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  source?: string;
  notes?: string;
};

type EstimateResp = { macro: Omit<Meal, 'id' | 't'> | null; error?: string };
type MealsResp = { date: string; meals: Meal[] };

type HealthSample = {
  steps?: number;
  active_calories?: number;
  resting_calories?: number;
};

export function NutritionCard() {
  const [date, setDate] = useState<string>(() => localDateKey());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [health, setHealth] = useState<HealthSample | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Date rollover
  useEffect(() => {
    const t = setInterval(() => {
      const today = localDateKey();
      if (today !== date) setDate(today);
    }, 60_000);
    return () => clearInterval(t);
  }, [date]);

  const refetch = useCallback(async () => {
    try {
      const [mealsRes, healthRes] = await Promise.all([
        fetch(`/api/nutrition/${date}`, { cache: 'no-store' }),
        fetch(`/api/health/sync`, { cache: 'no-store' }),
      ]);
      if (!mealsRes.ok) throw new Error(`fetch ${mealsRes.status}`);
      const body = (await mealsRes.json()) as MealsResp;
      setMeals(body.meals || []);
      if (healthRes.ok) {
        const hbody = (await healthRes.json()) as { health: HealthSample | null };
        setHealth(hbody.health);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHydrated(true);
    }
  }, [date]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const totals = meals.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      p: a.p + m.p,
      c: a.c + m.c,
      f: a.f + m.f,
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );

  const burned = (health?.active_calories || 0) + (health?.resting_calories || 0);
  // Net calories: target + burned - consumed = remaining you can still eat.
  // If burned is missing (no Apple Health sync), treat as 0.
  const remaining = DAILY_TARGETS.kcal + burned - totals.kcal;

  const addMeal = async (meal: Omit<Meal, 'id' | 't'>) => {
    const res = await fetch(`/api/nutrition/${date}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meal }),
    });
    if (res.ok) {
      const body = (await res.json()) as MealsResp;
      setMeals(body.meals || []);
    } else {
      setError(`save ${res.status}`);
    }
  };

  const deleteMeal = async (id: string) => {
    if (!confirm('Delete this meal?')) return;
    const res = await fetch(`/api/nutrition/${date}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, delete: true }),
    });
    if (res.ok) {
      const body = (await res.json()) as MealsResp;
      setMeals(body.meals || []);
    }
  };

  const estimateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || estimating) return;
    setEstimating(true);
    setError(null);
    try {
      const res = await fetch('/api/nutrition/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.trim() }),
      });
      const body = (await res.json()) as EstimateResp;
      if (!body.macro) {
        setError(body.error || 'estimate failed');
        return;
      }
      await addMeal({ ...body.macro, source: 'text' });
      setInput('');
    } catch (e) {
      setError((e as Error).message);
    }
    setEstimating(false);
  };

  const handlePhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // strip the "data:image/jpeg;base64," prefix to keep payload small for transport
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/nutrition/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, mime: file.type || 'image/jpeg' }),
      });
      const body = (await res.json()) as EstimateResp;
      if (!body.macro) {
        setError(body.error || 'photo estimate failed');
        return;
      }
      await addMeal({ ...body.macro, source: 'photo' });
    } catch (e) {
      setError((e as Error).message);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const kcalPctOfTarget = Math.min(100, Math.round((totals.kcal / DAILY_TARGETS.kcal) * 100));
  const proteinHit = totals.p >= DAILY_TARGETS.protein;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <div className="num text-3xl text-white/90">{totals.kcal}</div>
        <div className="text-xs text-white/40">of {DAILY_TARGETS.kcal} kcal</div>
      </div>
      <div className={`num mt-1 text-xs ${remaining >= 0 ? 'text-red-400/80' : 'text-emerald-300/80'}`}>
        {remaining >= 0 ? `−${remaining} deficit` : `+${-remaining} surplus`}
        {burned > 0 && (
          <span className="ml-2 text-white/40">· burned {Math.round(burned)} (Apple Health)</span>
        )}
      </div>
      {health?.steps !== undefined && (
        <div className="num mt-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
          {health.steps.toLocaleString()} steps today
        </div>
      )}

      {/* kcal progress bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className={`h-full transition-all ${kcalPctOfTarget >= 100 ? 'bg-amber-400/70' : 'bg-emerald-400/60'}`}
          style={{ width: `${kcalPctOfTarget}%` }}
        />
      </div>

      {/* Macros */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
        {(['protein', 'carbs', 'fat'] as const).map((mk) => {
          const v = mk === 'protein' ? totals.p : mk === 'carbs' ? totals.c : totals.f;
          const tgt = mk === 'protein' ? DAILY_TARGETS.protein : mk === 'carbs' ? DAILY_TARGETS.carbs : DAILY_TARGETS.fat;
          const hit = mk === 'protein' ? proteinHit : v >= tgt;
          return (
            <div key={mk}>
              <div>{mk}</div>
              <div className={`num mt-1 ${hit ? 'text-emerald-300' : 'text-white/80'}`}>
                {Math.round(v)}/{tgt}g
              </div>
            </div>
          );
        })}
      </div>

      {/* Add by text */}
      <form onSubmit={estimateAndAdd} className="mt-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
        <span className="text-white/30">+</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Log a meal — "chicken bowl 500cal" or "two eggs + toast"'
          className="flex-1 bg-transparent text-sm text-white/80 outline-none placeholder-white/30"
          disabled={estimating}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || estimating}
          className="min-h-9 rounded border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/60 hover:bg-white/[0.04] disabled:opacity-40"
          title="Estimate from a photo"
        >
          {uploading ? '📷…' : '📷'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handlePhoto(f);
          }}
          className="hidden"
        />
        <button
          type="submit"
          disabled={estimating || !input.trim()}
          className="min-h-9 rounded border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
        >
          {estimating ? '…' : 'Log'}
        </button>
      </form>

      {error && <p className="mt-2 text-[11px] text-red-400/80">⚠ {error}</p>}

      {/* Meals list */}
      <div className="mt-4 flex flex-col divide-y divide-white/[0.04]">
        {!hydrated && <p className="py-2 text-[11px] text-white/40">Loading…</p>}
        {hydrated && meals.length === 0 && <p className="py-2 text-[11px] text-white/40">No meals logged yet.</p>}
        {meals.map((m) => (
          <div key={m.id} className="group flex items-start gap-2 py-2 text-[11px]">
            <span className="num shrink-0 text-white/35">
              {new Date(m.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-white/85">{m.name}</div>
              <div className="num text-[10px] text-white/40">
                {m.kcal}k · {Math.round(m.p)}p · {Math.round(m.c)}c · {Math.round(m.f)}f
                {m.source === 'photo' && <span className="ml-1">📷</span>}
              </div>
            </div>
            <button
              onClick={() => deleteMeal(m.id)}
              className="shrink-0 text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-red-400/80"
              aria-label="Delete meal"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
