import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Txn = {
  txn_date: string;
  amount: number;
  vendor: string | null;
  is_business: boolean;
  subscription_confirmed: boolean | null;
};

/**
 * GET /api/finance/cash-flow?starting_balance=NNNN
 *
 * Projects daily cash position for the next 30 days using two signals:
 *   • Average daily NON-recurring spend (90-day rolling avg).
 *   • Recurring bills (confirmed subs + vendors seen in 3+ of last 4 months)
 *     landed on their expected day-of-month.
 *
 * Returns a per-day series of {date, projected_balance, recurring_charges,
 * baseline_drag} so the UI can chart the curve and mark when bills hit.
 *
 * starting_balance defaults to 0 if not supplied — the UI lets the user
 * enter their current checking balance to anchor the projection.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startingBalance = Number(searchParams.get('starting_balance') || 0);

  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from('transactions')
    .select('txn_date, amount, vendor, is_business, subscription_confirmed')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const txns = (data || []) as Txn[];

  // --- Identify recurring vendors and project them onto the next 30 days ---
  type VendorAgg = {
    vendor: string;
    months: Set<string>;
    daysOfMonth: number[];
    amounts: number[];
    confirmed: boolean;
  };
  const map = new Map<string, VendorAgg>();
  for (const t of txns) {
    if (!t.vendor) continue;
    const key = t.vendor.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        vendor: t.vendor.trim(),
        months: new Set(),
        daysOfMonth: [],
        amounts: [],
        confirmed: !!t.subscription_confirmed,
      });
    }
    const v = map.get(key)!;
    if (t.subscription_confirmed) v.confirmed = true;
    v.months.add(t.txn_date.slice(0, 7));
    v.daysOfMonth.push(Number(t.txn_date.slice(8, 10)));
    v.amounts.push(Number(t.amount));
  }

  const recurring: { vendor: string; day_of_month: number; amount: number }[] = [];
  let recurringTotal = 0;
  for (const v of map.values()) {
    const isRecurring = v.confirmed || v.months.size >= 3;
    if (!isRecurring) continue;
    const expectedDay = modeOf(v.daysOfMonth);
    const expectedAmount = median(v.amounts);
    recurring.push({ vendor: v.vendor, day_of_month: expectedDay, amount: expectedAmount });
    recurringTotal += expectedAmount;
  }

  // --- Compute non-recurring 90-day spend & convert to daily baseline ---
  const recurringVendorKeys = new Set(
    recurring.map((r) => r.vendor.toLowerCase()),
  );
  const nonRecurringSpend = txns
    .filter((t) => !t.vendor || !recurringVendorKeys.has(t.vendor.trim().toLowerCase()))
    .reduce((s, t) => s + Number(t.amount), 0);
  const dailyBaseline = nonRecurringSpend / 90;

  // --- Build the 30-day forecast ---
  let balance = startingBalance;
  const series: {
    date: string;
    projected_balance: number;
    recurring_charges: { vendor: string; amount: number }[];
    baseline_drag: number;
  }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dom = d.getDate();
    const hits = recurring.filter((r) => r.day_of_month === dom);
    const recurringSum = hits.reduce((s, h) => s + h.amount, 0);
    balance -= dailyBaseline;
    balance -= recurringSum;
    series.push({
      date: dateStr,
      projected_balance: Math.round(balance * 100) / 100,
      recurring_charges: hits.map((h) => ({ vendor: h.vendor, amount: round(h.amount) })),
      baseline_drag: round(dailyBaseline),
    });
  }

  return NextResponse.json({
    starting_balance: startingBalance,
    ending_balance: round(balance),
    daily_baseline: round(dailyBaseline),
    recurring_total_30d: round(
      series.reduce((s, d) => s + d.recurring_charges.reduce((a, c) => a + c.amount, 0), 0),
    ),
    recurring_count: recurring.length,
    sample_window_days: 90,
    series,
  });
}

function modeOf(arr: number[]): number {
  if (arr.length === 0) return 1;
  const counts = new Map<number, number>();
  for (const n of arr) counts.set(n, (counts.get(n) || 0) + 1);
  let best = arr[0];
  let bestCount = 0;
  for (const [n, c] of counts) {
    if (c > bestCount) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
