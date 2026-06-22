import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/finance/cc-bill-reminders
 *
 * Daily cron. If today is one of the configured CC payment dates, inserts a
 * "Pay X card" task with urgency=today. Dedups by (title, date) so re-runs
 * are safe.
 *
 * Schedule via vercel.json: daily at noon UTC = 5am PT.
 */
type Reminder = {
  day_of_month: number;
  title: string;
  memo: string;
};

const REMINDERS: Reminder[] = [
  {
    day_of_month: 13,
    title: 'Pay Chase Freedom Unlimited (2860)',
    memo: 'Statement closes ~21st, due ~18th. Pay the full Statement Balance to avoid interest. Set AutoPay to Statement Balance, not minimum.',
  },
  {
    day_of_month: 20,
    title: 'Pay Chase Freedom (4316)',
    memo: 'Statement closes ~28th, due ~25th. Pay the full Statement Balance to avoid the ~$100/mo interest. Set AutoPay to Statement Balance, not minimum.',
  },
];

export async function GET(_req: NextRequest) {
  const today = localDateKey();
  const dayOfMonth = Number(today.slice(8, 10));

  const matches = REMINDERS.filter((r) => r.day_of_month === dayOfMonth);
  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const r of matches) {
    // Dedup: don't insert if a task with the same title is already open OR was completed today.
    const { data: existing } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', USER_ID)
      .eq('title', r.title)
      .or(`completed_at.is.null,completed_at.gte.${today}`)
      .limit(1);
    if (existing && existing.length > 0) {
      skipped.push(r.title);
      continue;
    }
    const { error } = await supabase.from('tasks').insert({
      user_id: USER_ID,
      title: r.title,
      description: r.memo,
      urgency: 'today',
      category: 'deep-admin',
      estimated_minutes: 5,
      is_pinned: true,
    });
    if (!error) inserted.push(r.title);
  }

  return NextResponse.json({ ok: true, today, day_of_month: dayOfMonth, inserted, skipped });
}
