import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Txn = {
  txn_date: string;
  amount: number;
  is_business: boolean;
  needs_review: boolean | null;
};

/**
 * GET /api/finance/income
 *
 * Three income views, each split into personal + business:
 *   • rolling_30d — sum of income (amount < 0) in the last 30 days
 *   • this_month  — sum of income for the current calendar month
 *   • estimated   — 12-week trailing average projected to a calendar month
 *
 * Income = transactions with amount < 0 (existing convention in
 * /api/finance/summary). is_business splits the buckets.
 */
export async function GET(_req: NextRequest) {
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 84); // 12 weeks

  const { data: rows, error } = await supabase
    .from('transactions')
    .select('txn_date, amount, is_business, needs_review')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .lt('amount', 0)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const txns = (rows || []) as Txn[];

  const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const cutoff30 = new Date(today);
  cutoff30.setDate(cutoff30.getDate() - 30);
  const cutoff30Str = cutoff30.toISOString().slice(0, 10);

  let rolling30Personal = 0;
  let rolling30Business = 0;
  let thisMonthPersonal = 0;
  let thisMonthBusiness = 0;
  let twelveWeekPersonal = 0;
  let twelveWeekBusiness = 0;

  for (const t of txns) {
    const abs = Math.abs(Number(t.amount));
    const isBiz = !!t.is_business;
    twelveWeekPersonal += isBiz ? 0 : abs;
    twelveWeekBusiness += isBiz ? abs : 0;
    if (t.txn_date >= cutoff30Str) {
      rolling30Personal += isBiz ? 0 : abs;
      rolling30Business += isBiz ? abs : 0;
    }
    if (t.txn_date.slice(0, 7) === thisMonthKey) {
      thisMonthPersonal += isBiz ? 0 : abs;
      thisMonthBusiness += isBiz ? abs : 0;
    }
  }

  // Estimated monthly = 12-week sum / 12 * 4.33 (weeks per month).
  const WEEKS_PER_MONTH = 4.345;
  const estimatedMonthlyPersonal = (twelveWeekPersonal / 12) * WEEKS_PER_MONTH;
  const estimatedMonthlyBusiness = (twelveWeekBusiness / 12) * WEEKS_PER_MONTH;

  return NextResponse.json({
    rolling_30d: {
      personal: round(rolling30Personal),
      business: round(rolling30Business),
      total: round(rolling30Personal + rolling30Business),
    },
    this_month: {
      personal: round(thisMonthPersonal),
      business: round(thisMonthBusiness),
      total: round(thisMonthPersonal + thisMonthBusiness),
    },
    estimated_monthly: {
      personal: round(estimatedMonthlyPersonal),
      business: round(estimatedMonthlyBusiness),
      total: round(estimatedMonthlyPersonal + estimatedMonthlyBusiness),
    },
    sample_size: txns.length,
    sample_window_days: 84,
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
