import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/tasks/unplaced
 * Lists open tasks that recalc skipped or never categorized — the ones
 * sitting invisible to the calendar. Each result has a reason so the UI
 * can explain why it wasn't placed.
 */
export async function GET() {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, urgency, category, energy, estimated_minutes, key, tags, due_date, created_at, assigned_block_id')
    .eq('user_id', USER_ID)
    .is('completed_at', null)
    .is('assigned_block_id', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (tasks || []).map((t) => {
    let reason = 'No matching block this week';
    if (!t.category) reason = 'No category — auto-classifier could not infer';
    else if (t.category === 'meeting') reason = 'Meeting category — needs a calendar slot';
    else if (t.category === 'personal') reason = 'Personal category — block engine skips these';
    return { ...t, reason };
  });

  return NextResponse.json({ unplaced: items, count: items.length });
}
