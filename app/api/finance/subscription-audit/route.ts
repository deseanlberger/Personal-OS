import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Txn = {
  id: string;
  txn_date: string;
  amount: number;
  vendor: string | null;
  is_business: boolean;
  category: string | null;
  subscription_confirmed: boolean | null;
  subscription_status: string | null;
};

/**
 * GET /api/finance/subscription-audit
 *
 * Aggregates the last 6 months of charges by vendor and classifies each
 * vendor into one of:
 *   • confirmed       — user said YES this is a subscription
 *   • likely_sub      — seen in 3+ of last 4 months but not confirmed (Pending)
 *   • possible_sub    — seen in exactly 2 of last 6 months (low confidence)
 *   • dismissed       — user said NO this is not a sub
 *
 * Returns one row per vendor with monthly cost, annual cost, last seen,
 * recent transaction IDs so the UI can offer "mark as sub / not a sub" buttons.
 */
export async function GET(_req: NextRequest) {
  const since = new Date();
  since.setMonth(since.getMonth() - 6);

  const { data, error } = await supabase
    .from('transactions')
    .select('id, txn_date, amount, vendor, is_business, category, subscription_confirmed, subscription_status')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const txns = (data || []) as Txn[];

  type VendorAgg = {
    vendor: string;
    months: Set<string>;
    last_date: string;
    last_amount: number;
    amounts: number[];
    is_business: boolean;
    category: string | null;
    confirmed_count: number;
    dismissed_count: number;
    txn_ids: string[];
  };
  const map = new Map<string, VendorAgg>();
  for (const t of txns) {
    if (!t.vendor) continue;
    const key = t.vendor.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        vendor: t.vendor.trim(),
        months: new Set(),
        last_date: '',
        last_amount: 0,
        amounts: [],
        is_business: t.is_business,
        category: t.category,
        confirmed_count: 0,
        dismissed_count: 0,
        txn_ids: [],
      });
    }
    const v = map.get(key)!;
    v.months.add(t.txn_date.slice(0, 7));
    v.amounts.push(Number(t.amount));
    if (t.txn_date > v.last_date) {
      v.last_date = t.txn_date;
      v.last_amount = Number(t.amount);
    }
    if (t.subscription_confirmed === true) v.confirmed_count++;
    if (t.subscription_confirmed === false) v.dismissed_count++;
    v.txn_ids.push(t.id);
  }

  type Item = {
    vendor: string;
    status: 'confirmed' | 'dismissed' | 'likely_sub' | 'possible_sub';
    monthly_cost: number;
    annual_cost: number;
    months_seen: number;
    last_amount: number;
    last_date: string;
    is_business: boolean;
    category: string | null;
    txn_ids: string[];
  };
  const items: Item[] = [];
  for (const v of map.values()) {
    const monthsSeen = v.months.size;
    const avg = v.amounts.reduce((s, n) => s + n, 0) / v.amounts.length;

    let status: Item['status'];
    if (v.confirmed_count > 0 && v.confirmed_count >= v.dismissed_count) status = 'confirmed';
    else if (v.dismissed_count > 0 && v.dismissed_count > v.confirmed_count) status = 'dismissed';
    else if (monthsSeen >= 3) status = 'likely_sub';
    else if (monthsSeen >= 2) status = 'possible_sub';
    else continue; // singletons aren't subs

    items.push({
      vendor: v.vendor,
      status,
      monthly_cost: round(avg),
      annual_cost: round(avg * 12),
      months_seen: monthsSeen,
      last_amount: round(v.last_amount),
      last_date: v.last_date,
      is_business: v.is_business,
      category: v.category,
      txn_ids: v.txn_ids.slice(0, 10),
    });
  }
  items.sort((a, b) => b.monthly_cost - a.monthly_cost);

  // Totals split by status
  const totals = {
    confirmed_monthly: 0,
    likely_monthly: 0,
    possible_monthly: 0,
    confirmed_annual: 0,
    confirmed_business_annual: 0,
    confirmed_personal_annual: 0,
  };
  for (const i of items) {
    if (i.status === 'confirmed') {
      totals.confirmed_monthly += i.monthly_cost;
      totals.confirmed_annual += i.annual_cost;
      if (i.is_business) totals.confirmed_business_annual += i.annual_cost;
      else totals.confirmed_personal_annual += i.annual_cost;
    } else if (i.status === 'likely_sub') totals.likely_monthly += i.monthly_cost;
    else if (i.status === 'possible_sub') totals.possible_monthly += i.monthly_cost;
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round(totals[k]);

  return NextResponse.json({ items, totals });
}

/**
 * POST /api/finance/subscription-audit
 * Body: { vendor: string, action: 'confirm' | 'dismiss' | 'reset' }
 *
 * Bulk-updates the subscription_confirmed column on every transaction for
 * that vendor in the last 6 months so the audit page persists.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.vendor || !body?.action) {
    return NextResponse.json({ error: 'vendor + action required' }, { status: 400 });
  }
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const value =
    body.action === 'confirm' ? true :
    body.action === 'dismiss' ? false :
    null;
  const vendorNorm = String(body.vendor).trim().toLowerCase();
  // Match on lowercase trim — use ilike for case insensitivity
  const { error, count } = await supabase
    .from('transactions')
    .update({ subscription_confirmed: value }, { count: 'exact' })
    .eq('user_id', USER_ID)
    .gte('txn_date', since.toISOString().slice(0, 10))
    .ilike('vendor', vendorNorm);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: count ?? 0 });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
