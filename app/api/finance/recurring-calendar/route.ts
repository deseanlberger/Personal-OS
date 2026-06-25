import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Txn = {
  vendor: string | null;
  amount: number;
  txn_date: string;
  is_business: boolean;
  category: string | null;
  subscription_confirmed: boolean | null;
  subscription_status: string | null;
};

/**
 * GET /api/finance/recurring-calendar?month=YYYY-MM
 *
 * Returns one entry per recurring charge projected onto the requested
 * month, sorted by day. A charge is "recurring" if it has been confirmed
 * via subscription_confirmed=true OR if it appears in 3+ distinct months
 * within the last 4. The expected day is the mode day-of-month observed.
 *
 * UI uses this to draw a month-grid showing collision weeks (when too many
 * bills hit at once).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);

  // 4-month lookback to identify recurrence patterns
  const since = new Date(`${month}-01`);
  since.setMonth(since.getMonth() - 4);

  const { data, error } = await supabase
    .from('transactions')
    .select('vendor, amount, txn_date, is_business, category, subscription_confirmed, subscription_status')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const txns = (data || []) as Txn[];

  // Group by vendor, collect (month, day, amount)
  type VendorAgg = {
    vendor: string;
    is_business: boolean;
    category: string | null;
    confirmed: boolean;
    months: Set<string>;
    daysOfMonth: number[];
    amounts: number[];
  };
  const map = new Map<string, VendorAgg>();
  for (const t of txns) {
    if (!t.vendor) continue;
    const key = t.vendor.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        vendor: t.vendor.trim(),
        is_business: t.is_business,
        category: t.category,
        confirmed: !!t.subscription_confirmed,
        months: new Set(),
        daysOfMonth: [],
        amounts: [],
      });
    }
    const v = map.get(key)!;
    if (t.subscription_confirmed) v.confirmed = true;
    v.months.add(t.txn_date.slice(0, 7));
    v.daysOfMonth.push(Number(t.txn_date.slice(8, 10)));
    v.amounts.push(Number(t.amount));
  }

  // Filter to recurring + project onto requested month
  const items: {
    vendor: string;
    expected_day: number;
    expected_amount: number;
    is_business: boolean;
    category: string | null;
    confirmed: boolean;
    months_seen: number;
  }[] = [];
  for (const v of map.values()) {
    const isRecurring = v.confirmed || v.months.size >= 3;
    if (!isRecurring) continue;
    const expectedDay = modeOrAvg(v.daysOfMonth);
    const expectedAmount = median(v.amounts);
    items.push({
      vendor: v.vendor,
      expected_day: expectedDay,
      expected_amount: round(expectedAmount),
      is_business: v.is_business,
      category: v.category,
      confirmed: v.confirmed,
      months_seen: v.months.size,
    });
  }
  items.sort((a, b) => a.expected_day - b.expected_day);

  const total = items.reduce((s, i) => s + i.expected_amount, 0);
  return NextResponse.json({ month, items, total: round(total) });
}

function modeOrAvg(arr: number[]): number {
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
