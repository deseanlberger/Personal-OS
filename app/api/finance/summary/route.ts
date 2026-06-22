import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getMeta } from '@/lib/app_meta';

const USER_ID = process.env.USER_ID || 'desean';

// Defaults if not configured via app_meta
const DEFAULT_TAX_PCT = 15;
const DEFAULT_TITHE_PCT = 10;
const DEFAULT_SAVINGS_PCT = 10;

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

function pickPct(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const months = Math.min(Math.max(Number(searchParams.get('months') || 12), 1), 24);

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

  // Goal percentages (configurable via app_meta keys; defaults baked in)
  const [taxPctRaw, titheRaw, savingsRaw] = await Promise.all([
    getMeta('finance_tax_pct'),
    getMeta('finance_tithe_pct'),
    getMeta('finance_savings_pct'),
  ]);
  const tax_pct = pickPct(taxPctRaw, DEFAULT_TAX_PCT);
  const tithe_pct = pickPct(titheRaw, DEFAULT_TITHE_PCT);
  const savings_pct = pickPct(savingsRaw, DEFAULT_SAVINGS_PCT);

  const all = (txns || []) as Txn[];
  const spends = all.filter((t) => Number(t.amount) > 0);
  const incomes = all.filter((t) => Number(t.amount) < 0);

  type MonthBucket = {
    month: string;
    personal: number;
    business: number;
    spent: number;
    income: number;
    net: number;
    count: number;
  };
  const monthMap = new Map<string, MonthBucket>();
  function bucketFor(month: string): MonthBucket {
    if (!monthMap.has(month)) {
      monthMap.set(month, { month, personal: 0, business: 0, spent: 0, income: 0, net: 0, count: 0 });
    }
    return monthMap.get(month)!;
  }
  for (const t of spends) {
    const month = t.txn_date.slice(0, 7);
    const b = bucketFor(month);
    const amt = Number(t.amount);
    b.spent += amt;
    if (t.is_business) b.business += amt;
    else b.personal += amt;
    b.count++;
  }
  for (const t of incomes) {
    const month = t.txn_date.slice(0, 7);
    const b = bucketFor(month);
    b.income += Math.abs(Number(t.amount));
    b.count++;
  }
  for (const b of monthMap.values()) {
    b.net = b.income - b.spent;
  }
  const totals_by_month = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // By category — spends only
  type CatBucket = { category: string; amount: number; count: number };
  const catMap = new Map<string, CatBucket>();
  for (const t of spends) {
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
  for (const t of spends) {
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

  // Subscription detection — vendors that appear in 2+ distinct months in last 6mo
  type VendorMonths = { vendor: string; months: Set<string>; total: number; last_amount: number; last_date: string };
  const vendorMonthsMap = new Map<string, VendorMonths>();
  const recentCutoff = new Date();
  recentCutoff.setMonth(recentCutoff.getMonth() - 6);
  const recentCutoffStr = recentCutoff.toISOString().slice(0, 10);
  for (const t of spends) {
    if (t.txn_date < recentCutoffStr) continue;
    const vendor = (t.vendor || '').trim();
    if (!vendor) continue;
    if (!vendorMonthsMap.has(vendor)) {
      vendorMonthsMap.set(vendor, {
        vendor,
        months: new Set(),
        total: 0,
        last_amount: Number(t.amount),
        last_date: t.txn_date,
      });
    }
    const v = vendorMonthsMap.get(vendor)!;
    v.months.add(t.txn_date.slice(0, 7));
    v.total += Number(t.amount);
    if (t.txn_date > v.last_date) {
      v.last_date = t.txn_date;
      v.last_amount = Number(t.amount);
    }
  }
  const subscriptions = Array.from(vendorMonthsMap.values())
    .filter((v) => v.months.size >= 2)
    .map((v) => ({
      vendor: v.vendor,
      months_seen: v.months.size,
      total_6mo: v.total,
      last_amount: v.last_amount,
      last_date: v.last_date,
      avg_per_month: v.total / v.months.size,
    }))
    .sort((a, b) => b.avg_per_month - a.avg_per_month)
    .slice(0, 20);

  // Top vendors overall
  type VendorBucket = { vendor: string; amount: number; count: number };
  const vendorMap = new Map<string, VendorBucket>();
  for (const t of spends) {
    const vendor = (t.vendor || '(no vendor)').trim();
    if (!vendorMap.has(vendor)) vendorMap.set(vendor, { vendor, amount: 0, count: 0 });
    const b = vendorMap.get(vendor)!;
    b.amount += Number(t.amount);
    b.count++;
  }
  const by_vendor = Array.from(vendorMap.values()).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // This month / last month
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const emptyBucket: MonthBucket = { month: '', personal: 0, business: 0, spent: 0, income: 0, net: 0, count: 0 };
  const thisMonth = monthMap.get(thisMonthKey) || { ...emptyBucket, month: thisMonthKey };
  const lastMonth = monthMap.get(lastMonthKey) || { ...emptyBucket, month: lastMonthKey };
  const mom_pct = lastMonth.spent > 0 ? ((thisMonth.spent - lastMonth.spent) / lastMonth.spent) * 100 : null;

  // Transfers to Make (computed off this month's income)
  const transfers = {
    tax: { pct: tax_pct, amount: thisMonth.income * (tax_pct / 100) },
    tithe: { pct: tithe_pct, amount: thisMonth.income * (tithe_pct / 100) },
    savings: { pct: savings_pct, amount: thisMonth.income * (savings_pct / 100) },
  };

  return NextResponse.json({
    months,
    totals_by_month,
    by_category,
    by_account,
    by_vendor,
    subscriptions,
    this_month: thisMonth,
    last_month: lastMonth,
    mom_pct,
    transfers,
    total_transactions: all.length,
    total_spend: spends.reduce((s, t) => s + Number(t.amount), 0),
    total_income: incomes.reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
    settings: { tax_pct, tithe_pct, savings_pct },
  });
}
