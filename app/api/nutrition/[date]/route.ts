import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Meal = {
  id: string;
  t: string;        // ISO timestamp when logged
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  source?: 'text' | 'photo' | 'manual';
  notes?: string;
};

type Notes = {
  nutrition?: { meals: Meal[]; updated_at?: string };
  [key: string]: unknown;
};

function parseNotes(raw: string | null): Notes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function loadDay(date: string): Promise<Notes> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', date)
    .maybeSingle();
  if (error) {
    console.error('[nutrition.load]', error.message);
    return {};
  }
  return parseNotes(data?.notes ?? null);
}

async function saveDay(date: string, notes: Notes): Promise<void> {
  const { error } = await supabase
    .from('daily_logs')
    .upsert(
      {
        user_id: USER_ID,
        log_date: date,
        notes: JSON.stringify(notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,log_date' },
    );
  if (error) throw new Error(error.message);
}

/** GET /api/nutrition/[date] — list meals for the date */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const notes = await loadDay(date);
  return NextResponse.json({ date, meals: notes.nutrition?.meals || [] });
}

/**
 * POST /api/nutrition/[date]
 *   { meal: Meal }        → add a meal
 *   { id: string, patch }  → edit a meal
 *   { id: string, delete: true } → remove a meal
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const notes = await loadDay(date);
  const meals = [...(notes.nutrition?.meals || [])];

  if (body.delete && typeof body.id === 'string') {
    const idx = meals.findIndex((m) => m.id === body.id);
    if (idx >= 0) meals.splice(idx, 1);
  } else if (body.patch && typeof body.id === 'string') {
    const idx = meals.findIndex((m) => m.id === body.id);
    if (idx >= 0) {
      meals[idx] = { ...meals[idx], ...body.patch };
    }
  } else if (body.meal) {
    const meal: Meal = {
      id: body.meal.id || crypto.randomUUID(),
      t: body.meal.t || new Date().toISOString(),
      name: String(body.meal.name || '').slice(0, 200),
      kcal: Math.max(0, Math.round(Number(body.meal.kcal) || 0)),
      p: Math.max(0, Number(body.meal.p) || 0),
      c: Math.max(0, Number(body.meal.c) || 0),
      f: Math.max(0, Number(body.meal.f) || 0),
      source: body.meal.source || 'text',
      notes: body.meal.notes ? String(body.meal.notes).slice(0, 300) : undefined,
    };
    meals.push(meal);
  } else {
    return NextResponse.json({ error: 'meal | id+patch | id+delete required' }, { status: 400 });
  }

  notes.nutrition = { meals, updated_at: new Date().toISOString() };
  try {
    await saveDay(date, notes);
    return NextResponse.json({ date, meals });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
