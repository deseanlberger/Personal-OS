import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Txn = {
  id: string;
  txn_date: string;
  amount: number;
  vendor: string | null;
  category: string | null;
  is_business: boolean;
  account_id: string | null;
  needs_review: boolean | null;
};

type AccountLite = { id: string; name: string; short_name: string | null; last_4: string | null };

/**
 * GET /api/finance/summary?months=6
 * Returns multi-axis aggregates over confirmed transactions:
 *   - totals_by_month: per-month spend split into personal/business
 *   - by_category: total spend per category over the window
 *   - by_account: total spend per account (account name resolved)
 *   - by_vendor: top 10 vendors by amount
 *   - this_month / last_month: quick comparison
 *   - month_over_month_pct: % change vs previous month
 * Only confirmed transactions (needs_review=false) count toward totals so
 * pending receipts don't skew the dashboard before they're triaged.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const months = Math.min(Math.max(Number(searchParams.get('months') || 6), 1), 24);

  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setDate(1);

  const { data: txns, error } = await supabase
    .from('transactions')
    .select('id, txn_date, amount, vendor, category, is_business, account_id, needs_review')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gte('txn_date', since.toISOString().slice(0, 10))
    .order('txn_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, name, short_name, last_4')
    .eq('user_id', USER_ID);
  const accountById = new Map<string, AccountLite>(
    (accounts || []).map((a) => [a.id, a as AccountLite]),
  );

  const all = ((txns || []) as Txn[]).filter((t) => Number(t.amount) > 0);

  // Per month: { 'YYYY-MM' → { personal, business, total, count } }
  type MonthBucket = { month: string; personal: number; business: number; total: number; count: number };
  const monthMap = new Map<string, MonthBucket>();
  for (const t of all) {
    const month = t.txn_date.slice(0, 7);
    if (!monthMap.has(month)) {
      monthMap.set(month, { month, personal: 0, business: 0, total: 0, count: 0 });
    }
    const bucket = monthMap.get(month)!;
    const amt = Number(t.amount);
    bucket.total += amt;
    if (t.is_business) bucket.business += amt;
    else bucket.personal += amt;
    bucket.count++;
  }
  const totals_by_month = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // By category
  type CatBucket = { category: string; amount: number; count: number };
  const catMap = new Map<string, CatBucket>();
  for (const t of all) {
    const cat = t.category || 'uncategorized';
    if (!catMap.has(cat)) catMap.set(cat, { category: cat, amount: 0, count: 0 });
    const b = catMap.get(cat)!;
    b.amount += Number(t.amount);
    b.count++;
  }
  const by_category = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);

  // By account
  type AcctBucket = { account_id: string | null; account_name: string; account_short: string | null; amount: number; count: number };
  const acctMap = new Map<string, AcctBucket>();
  for (const t of all) {
    const id = t.account_id || 'unassigned';
    if (!acctMap.has(id)) {
      const acct = t.account_id ? accountById.get(t.account_id) : null;
      acctMap.set(id, {
        account_id: t.account_id,
        account_name: acct?.name || (t.account_id ? 'Unknown' : 'No account'),
        account_short: acct?.short_name || null,
        amount: 0,
        count: 0,
      });
    }
    const b = acctMap.get(id)!;
    b.amount += Number(t.amount);
    b.count++;
  }
  const by_account = Array.from(acctMap.values()).sort((a, b) => b.amount - a.amount);

  // By vendor (top 10)
  type VendorBucket = { vendor: string; amount: number; count: number };
  const vendorMap = new Map<string, VendorBucket>();
  for (const t of all) {
    const vendor = (t.vendor || '(no vendor)').trim();
    if (!vendorMap.has(vendor)) vendorMap.set(vendor, { vendor, amount: 0, count: 0 });
    const b = vendorMap.get(vendor)!;
    b.amount += Number(t.amount);
    b.count++;
  }
  const by_vendor = Array.from(vendorMap.values()).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // This month vs last month
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const thisMonth = monthMap.get(thisMonthKey) || { month: thisMonthKey, personal: 0, business: 0, total: 0, count: 0 };
  const lastMonth = monthMap.get(lastMonthKey) || { month: lastMonthKey, personal: 0, business: 0, total: 0, count: 0 };
  const month_over_month_pct = lastMonth.total > 0 ? ((thisMonth.total - lastMonth.total) / lastMonth.total) * 100 : null;

  return NextResponse.json({
    months,
    totals_by_month,
    by_category,
    by_account,
    by_vendor,
    this_month: thisMonth,
    last_month: lastMonth,
    month_over_month_pct,
    total_transactions: all.length,
    total_spend: all.reduce((s, t) => s + Number(t.amount), 0),
  });
}
