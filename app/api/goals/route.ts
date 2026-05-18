import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';
// Sentinel date so goals never auto-clear at week/month boundaries.
// (Per cheat sheet 5.7 — goals are persistent, user-managed.)
const SENTINEL_DATE = '2000-01-01';

export type GoalItem = {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
  completed_at?: string | null;
};

export type GoalScope = 'week' | 'month';

type Notes = {
  goals_week_items?: GoalItem[];
  goals_month_items?: GoalItem[];
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

async function loadGoals(): Promise<Notes> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('notes')
    .eq('user_id', USER_ID)
    .eq('log_date', SENTINEL_DATE)
    .maybeSingle();
  if (error) {
    console.error('[goals.load]', error.message);
    return {};
  }
  return parseNotes(data?.notes ?? null);
}

async function saveGoals(notes: Notes): Promise<void> {
  const { error } = await supabase
    .from('daily_logs')
    .upsert(
      {
        user_id: USER_ID,
        log_date: SENTINEL_DATE,
        notes: JSON.stringify(notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,log_date' },
    );
  if (error) throw new Error(error.message);
}

function keyFor(scope: GoalScope): 'goals_week_items' | 'goals_month_items' {
  return scope === 'week' ? 'goals_week_items' : 'goals_month_items';
}

/** GET /api/goals — returns both week + month lists */
export async function GET() {
  const notes = await loadGoals();
  return NextResponse.json({
    week: notes.goals_week_items || [],
    month: notes.goals_month_items || [],
  });
}

/**
 * POST /api/goals
 *   { scope: 'week'|'month', action: 'add',    text: string }
 *   { scope: 'week'|'month', action: 'toggle', id: string }
 *   { scope: 'week'|'month', action: 'remove', id: string }
 *   { scope: 'week'|'month', action: 'edit',   id: string, text: string }
 *   { scope: 'week'|'month', action: 'clear_done' }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || (body.scope !== 'week' && body.scope !== 'month')) {
    return NextResponse.json({ error: 'scope must be week|month' }, { status: 400 });
  }
  const scope = body.scope as GoalScope;
  const key = keyFor(scope);

  const notes = await loadGoals();
  const items = [...(notes[key] || [])];

  switch (body.action) {
    case 'add': {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
      items.push({
        id: crypto.randomUUID(),
        text: text.slice(0, 280),
        done: false,
        created_at: new Date().toISOString(),
      });
      break;
    }
    case 'toggle': {
      const idx = items.findIndex((g) => g.id === body.id);
      if (idx >= 0) {
        items[idx] = {
          ...items[idx],
          done: !items[idx].done,
          completed_at: !items[idx].done ? new Date().toISOString() : null,
        };
      }
      break;
    }
    case 'remove': {
      const idx = items.findIndex((g) => g.id === body.id);
      if (idx >= 0) items.splice(idx, 1);
      break;
    }
    case 'edit': {
      const idx = items.findIndex((g) => g.id === body.id);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (idx >= 0 && text) items[idx] = { ...items[idx], text: text.slice(0, 280) };
      break;
    }
    case 'clear_done': {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].done) items.splice(i, 1);
      }
      break;
    }
    default:
      return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  notes[key] = items;
  try {
    await saveGoals(notes);
    return NextResponse.json({
      week: notes.goals_week_items || [],
      month: notes.goals_month_items || [],
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
