'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type MonthBucket = {
  month: string;
  personal: number;
  business: number;
  spent: number;
  income: number;
  net: number;
  count: number;
};
type CatBucket = { category: string; amount: number; count: number };
type AcctBucket = { account_id: string | null; account_name: string; account_short: string | null; amount: number; count: number };
type VendorBucket = { vendor: string; amount: number; count: number };
type Subscription = {
  vendor: string;
  months_seen: number;
  total_6mo: number;
  last_amount: number;
  last_date: string;
  avg_per_month: number;
};

type StatusVendor = { vendor: string; amount: number; last_date: string };
type BudgetRow = {
  category: string;
  monthly_budget: number;
  avg_spent: number;
  avg_pct: number;
  per_month: { month: string; spent: number; pct: number }[];
};

type Summary = {
  months: number;
  totals_by_month: MonthBucket[];
  by_category: CatBucket[];
  by_account: AcctBucket[];
  by_vendor: VendorBucket[];
  subscriptions: Subscription[];
  this_month: MonthBucket;
  last_month: MonthBucket;
  mom_pct: number | null;
  transfers: {
    tax: { pct: number; amount: number };
    tithe: { pct: number; amount: number };
    savings: { pct: number; amount: number };
  };
  savings_tracker: {
    cancelled_monthly: number;
    cancelled_annual: number;
    could_cancel_monthly: number;
    could_cancel_annual: number;
    cancelled_items: StatusVendor[];
    could_cancel_items: StatusVendor[];
  };
  budgets: BudgetRow[];
  total_transactions: number;
  total_spend: number;
  total_income: number;
  settings: { tax_pct: number; tithe_pct: number; savings_pct: number };
};

// Donut palette — cycles through the category list
const DONUT_PALETTE = [
  '#f59e0b', // amber
  '#f97316', // orange
  '#10b981', // emerald
  '#3b82f6', // blue
  '#a855f7', // purple
  '#0ea5e9', // sky
  '#ec4899', // pink
  '#84cc16', // lime
  '#facc15', // yellow
  '#ef4444', // red
  '#6b7280', // gray
];

function fmtMoney(n: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const sign = opts.sign && n > 0 ? '+' : n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (opts.compact && v >= 1000) {
    return `${sign}$${(v / 1000).toFixed(1)}k`;
  }
  return `${sign}$${v.toFixed(2)}`;
}

function fmtMonthShort(monthKey: string): string {
  const [, m] = monthKey.split('-').map(Number);
  const d = new Date(2000, (m || 1) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short' });
}

function fmtMonthLong(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Build SVG donut paths
function donutPath(centerX: number, centerY: number, outerR: number, innerR: number, startAngle: number, endAngle: number): string {
  const x1 = centerX + outerR * Math.cos(startAngle);
  const y1 = centerY + outerR * Math.sin(startAngle);
  const x2 = centerX + outerR * Math.cos(endAngle);
  const y2 = centerY + outerR * Math.sin(endAngle);
  const x3 = centerX + innerR * Math.cos(endAngle);
  const y3 = centerY + innerR * Math.sin(endAngle);
  const x4 = centerX + innerR * Math.cos(startAngle);
  const y4 = centerY + innerR * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

export type FinanceScope = 'all' | 'personal' | 'business';

export function FinanceDashboard({
  refreshKey,
  scope = 'all',
}: {
  refreshKey?: number;
  scope?: FinanceScope;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/finance/summary?months=12&scope=${scope}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`summary ${res.status}`);
      const body = (await res.json()) as Summary;
      setData(body);
      setSelectedMonth((cur) => cur || body.this_month.month);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [scope]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey]);

  // Sliced month view: prefer selected month bucket; fall back to this_month
  const monthBucket = useMemo(() => {
    if (!data || !selectedMonth) return null;
    return data.totals_by_month.find((m) => m.month === selectedMonth) || null;
  }, [data, selectedMonth]);

  // Per-month category breakdown for the donut
  const monthCategories = useMemo(() => {
    if (!data || !selectedMonth) return [] as { category: string; amount: number; color: string }[];
    // Walk transactions? We don't have them in summary. Use overall by_category proportions when looking at the full window,
    // and use the by_category list as-is for an aggregate view. The simpler approach: show the per-month total split by
    // by_category from the FULL summary (which is over all months). This is a known simplification — we'd need a
    // per-month-category breakdown in the API to be exact. For now, fall back to the overall categorization.
    const total = data.by_category.reduce((s, c) => s + c.amount, 0);
    if (total === 0) return [];
    return data.by_category.map((c, i) => ({
      category: c.category,
      amount: c.amount,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
  }, [data, selectedMonth]);

  if (err) {
    return (
      <section className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">
        Summary failed: {err}
      </section>
    );
  }
  if (!data) {
    return (
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-white/40">
        Loading…
      </section>
    );
  }
  if (data.total_transactions === 0) {
    return null;
  }

  const monthsForTabs = data.totals_by_month.length > 0 ? data.totals_by_month : [data.this_month];
  const shownBucket = monthBucket || data.this_month;
  const maxMonthSpent = Math.max(...data.totals_by_month.map((m) => Math.max(m.spent, m.income)), 1);

  // Donut math
  const donutTotal = monthCategories.reduce((s, c) => s + c.amount, 0);
  let angle = -Math.PI / 2;
  const donutSlices = monthCategories.map((c) => {
    const slice = (c.amount / donutTotal) * Math.PI * 2;
    const start = angle;
    const end = angle + slice;
    angle = end;
    return { ...c, start, end, pct: (c.amount / donutTotal) * 100 };
  });

  const momTone = data.mom_pct === null ? 'text-white/40' : data.mom_pct > 0 ? 'text-amber-300' : 'text-emerald-300';
  const netTone = shownBucket.net >= 0 ? 'text-emerald-300' : 'text-red-300';

  return (
    <section className="space-y-5">
      {/* Month tab strip */}
      <div className="-mx-2 flex items-center gap-0.5 overflow-x-auto px-2 pb-1">
        {monthsForTabs.map((m) => {
          const active = m.month === selectedMonth;
          return (
            <button
              key={m.month}
              onClick={() => setSelectedMonth(m.month)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${
                active
                  ? 'bg-emerald-400/20 text-emerald-300'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {fmtMonthShort(m.month)}
            </button>
          );
        })}
      </div>

      {/* Selected month metrics — 4 cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">Real income</div>
          <div className="num mt-1 text-2xl text-emerald-300">{fmtMoney(shownBucket.income)}</div>
          <div className="mt-1 text-[10px] text-white/40">deposits + payments received</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Spent</div>
          <div className="num mt-1 text-2xl text-white/90">{fmtMoney(shownBucket.spent)}</div>
          <div className="mt-1 text-[10px] text-white/30">{shownBucket.count} txns</div>
        </div>
        <div className={`rounded-xl border p-4 ${shownBucket.net >= 0 ? 'border-emerald-400/30 bg-emerald-400/[0.04]' : 'border-red-400/30 bg-red-400/[0.04]'}`}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Net</div>
          <div className={`num mt-1 text-2xl ${netTone}`}>{fmtMoney(shownBucket.net, { sign: true })}</div>
          <div className="mt-1 text-[10px] text-white/40">income minus spend</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Business</div>
          <div className="num mt-1 text-2xl text-emerald-300/90">{fmtMoney(shownBucket.business)}</div>
          <div className="mt-1 text-[10px] text-white/30">tax write-off pool</div>
        </div>
      </div>

      {/* Spending donut + Transfers to Make */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Spending by category</div>
            <div className="text-[10px] text-white/30">last {data.months}mo</div>
          </div>
          {donutSlices.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-white/30">No spending data yet.</p>
          ) : (
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 200 200" className="size-44 shrink-0">
                {donutSlices.map((s, i) => (
                  <path key={i} d={donutPath(100, 100, 90, 60, s.start, s.end)} fill={s.color} />
                ))}
                <circle cx="100" cy="100" r="55" fill="#0a0a0a" />
                <text x="100" y="95" textAnchor="middle" className="num" fontSize="9" fill="#6b7280" style={{ textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                  TOTAL
                </text>
                <text x="100" y="115" textAnchor="middle" className="num" fontSize="14" fill="#e5e7eb">
                  {fmtMoney(donutTotal, { compact: true })}
                </text>
              </svg>
              <ul className="flex-1 space-y-1">
                {donutSlices.slice(0, 8).map((s) => (
                  <li key={s.category} className="flex items-center gap-2 text-[11px]">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate text-white/80">{s.category}</span>
                    <span className="num shrink-0 text-white/55">{fmtMoney(s.amount, { compact: true })}</span>
                    <span className="num w-10 shrink-0 text-right text-white/30">{s.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Income card replaces Transfers to Make */}
        <IncomeCard />
      </div>

      {/* Vendor leaderboard + Recurring calendar */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <VendorLeaderboard month={shownBucket.month} scope={scope} />
        <RecurringCalendar month={shownBucket.month} />
      </div>

      {/* Month-over-month strip */}
      {data.totals_by_month.length > 1 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Month over month</div>
            {data.mom_pct !== null && (
              <div className={`num text-[10px] ${momTone}`}>
                {data.mom_pct > 0 ? '▲' : '▼'} {Math.abs(data.mom_pct).toFixed(1)}% vs last month
              </div>
            )}
          </div>
          <div className="flex h-32 items-end gap-1.5">
            {data.totals_by_month.map((m) => {
              const spentPct = (m.spent / maxMonthSpent) * 100;
              const incomePct = (m.income / maxMonthSpent) * 100;
              const active = m.month === selectedMonth;
              return (
                <button
                  key={m.month}
                  onClick={() => setSelectedMonth(m.month)}
                  className="flex flex-1 flex-col items-center gap-1 transition hover:opacity-80"
                >
                  <div className="flex w-full flex-1 items-end gap-0.5">
                    <div className="flex-1 rounded-t" style={{ height: `${Math.max(incomePct, 1)}%`, background: '#10b98199' }} />
                    <div className="flex-1 rounded-t" style={{ height: `${Math.max(spentPct, 1)}%`, background: '#ffffff66' }} />
                  </div>
                  <div className={`text-[10px] uppercase tracking-[0.14em] ${active ? 'text-emerald-300' : 'text-white/45'}`}>
                    {fmtMonthShort(m.month)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-end gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-400/60" /> income</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-white/40" /> spent</span>
          </div>
        </div>
      )}

      {/* Subscriptions tracker */}
      {data.subscriptions.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Subscriptions detected</div>
            <div className="text-[10px] text-white/30">vendors seen 2+ months · last 6mo</div>
          </div>
          <ul className="space-y-1">
            {data.subscriptions.map((s) => (
              <li key={s.vendor} className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-black/20 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white/85">{s.vendor}</div>
                  <div className="num mt-0.5 text-[10px] text-white/35">
                    {s.months_seen} mo · last {fmtMoney(s.last_amount)} on {s.last_date}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-sm text-white/85">{fmtMoney(s.avg_per_month)}</div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">/ mo avg</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SavingsTracker tracker={data.savings_tracker} />
      <BudgetSection budgets={data.budgets} />
      {(scope === 'business' || scope === 'all') && <MileageCard />}
      <InsightsSection />
    </section>
  );
}

function MileageCard() {
  const [data, setData] = useState<{
    totals: { business_miles: number; personal_miles: number; total_miles: number; business_deduction_estimate: number };
    logs: { trip_date: string; from_address: string | null; to_address: string | null; miles: number; is_business: boolean; purpose: string | null }[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/finance/mileage?days=180', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          setErr(`${r.status}`);
          return;
        }
        setData(await r.json());
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return null;
  if (!data) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-white/40">
        Mileage loading…
      </div>
    );
  }
  const { business_miles, personal_miles, business_deduction_estimate } = data.totals;
  if (business_miles === 0 && personal_miles === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Mileage tracker</div>
        <div className="mt-2 text-[12px] text-white/40">
          No trips logged yet. Run the iOS Shortcut <em>Log Trip Mileage</em> after a drive to start tracking. Business miles count toward your 2026 IRS deduction at $0.67/mi.
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/85">Business miles</div>
        <div className="num mt-1 text-2xl text-emerald-300">{business_miles.toFixed(1)}</div>
        <div className="num mt-0.5 text-[10px] text-white/40">last 180 days</div>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Personal miles</div>
        <div className="num mt-1 text-2xl text-white/85">{personal_miles.toFixed(1)}</div>
        <div className="num mt-0.5 text-[10px] text-white/30">last 180 days</div>
      </div>
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/85">Tax deduction est.</div>
        <div className="num mt-1 text-2xl text-emerald-300">{fmtMoney(business_deduction_estimate)}</div>
        <div className="num mt-0.5 text-[10px] text-white/40">@ $0.67/mi · 2026 IRS rate</div>
      </div>
    </div>
  );
}

function SavingsTracker({ tracker }: { tracker: Summary['savings_tracker'] }) {
  const hasAny = tracker.cancelled_items.length > 0 || tracker.could_cancel_items.length > 0;
  if (!hasAny) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Savings tracker</div>
        <div className="mt-2 text-[12px] text-white/40">
          Mark a transaction as <strong>cancelled</strong> or <strong>could cancel</strong> in the list below to start tracking subscription savings.
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/85">Already saved</div>
        <div className="num mt-1 text-2xl text-emerald-300">{fmtMoney(tracker.cancelled_annual)}<span className="ml-1 text-[11px] text-emerald-300/60">/ yr</span></div>
        <div className="num mt-0.5 text-[10px] text-white/40">
          {fmtMoney(tracker.cancelled_monthly)} / mo · {tracker.cancelled_items.length} cancelled
        </div>
        {tracker.cancelled_items.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-white/65">
            {tracker.cancelled_items.slice(0, 5).map((v) => (
              <li key={v.vendor} className="flex items-center justify-between">
                <span className="truncate line-through decoration-emerald-400/50">{v.vendor}</span>
                <span className="num">{fmtMoney(v.amount)}/mo</span>
              </li>
            ))}
            {tracker.cancelled_items.length > 5 && <li className="text-white/30">+ {tracker.cancelled_items.length - 5} more</li>}
          </ul>
        )}
      </div>
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300/85">Could cancel</div>
        <div className="num mt-1 text-2xl text-amber-300">{fmtMoney(tracker.could_cancel_annual)}<span className="ml-1 text-[11px] text-amber-300/60">/ yr potential</span></div>
        <div className="num mt-0.5 text-[10px] text-white/40">
          {fmtMoney(tracker.could_cancel_monthly)} / mo · {tracker.could_cancel_items.length} flagged
        </div>
        {tracker.could_cancel_items.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-white/65">
            {tracker.could_cancel_items.slice(0, 5).map((v) => (
              <li key={v.vendor} className="flex items-center justify-between">
                <span className="truncate">{v.vendor}</span>
                <span className="num">{fmtMoney(v.amount)}/mo</span>
              </li>
            ))}
            {tracker.could_cancel_items.length > 5 && <li className="text-white/30">+ {tracker.could_cancel_items.length - 5} more</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function BudgetSection({ budgets }: { budgets: BudgetRow[] }) {
  const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState('food');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!cat || !Number.isFinite(n) || n < 0 || pending) return;
    setPending(true);
    await fetch('/api/finance/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: cat, monthly_amount: n }),
    });
    setAmount('');
    setAdding(false);
    setPending(false);
    setRefreshKey((v) => v + 1); // hint to parent — they should refetch when refreshKey changes
    // The parent re-fetches on its own refreshKey, but we trigger a soft reload by reloading the page
    if (typeof window !== 'undefined') window.location.reload();
  };
  const remove = async (category: string) => {
    if (!confirm(`Remove budget for ${category}?`)) return;
    await fetch(`/api/finance/budgets?category=${encodeURIComponent(category)}`, { method: 'DELETE' });
    if (typeof window !== 'undefined') window.location.reload();
  };
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Budgets</div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/70 hover:text-emerald-300"
        >
          {adding ? 'cancel' : '+ add'}
        </button>
      </div>
      {adding && (
        <form onSubmit={submit} className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/85 outline-none">
            {['food','gas','supplements','athlete-fees','rent','software','travel','gym-equipment','office','medical','other','uncategorized'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Monthly $ limit"
            inputMode="decimal"
            className="num rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/85 outline-none"
          />
          <button
            type="submit"
            disabled={!amount || pending}
            className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
      {budgets.length === 0 && !adding && (
        <div className="text-[12px] text-white/40">No budgets set. Click +add to start tracking a category.</div>
      )}
      <ul className="space-y-2">
        {budgets.map((b) => {
          const tone =
            b.avg_pct >= 100 ? 'border-red-400/40 bg-red-400/[0.06]'
            : b.avg_pct >= 80 ? 'border-amber-400/40 bg-amber-400/[0.06]'
            : 'border-emerald-400/30 bg-emerald-400/[0.06]';
          return (
            <li key={b.category} className={`group rounded-md border px-3 py-2 ${tone}`}>
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-white/85">{b.category}</div>
                <div className="flex items-center gap-3 num text-[11px] text-white/75">
                  <span>{fmtMoney(b.avg_spent)} avg</span>
                  <span>/ {fmtMoney(b.monthly_budget)}</span>
                  <span className={b.avg_pct >= 100 ? 'text-red-300' : b.avg_pct >= 80 ? 'text-amber-300' : 'text-emerald-300'}>
                    {b.avg_pct.toFixed(0)}%
                  </span>
                  <button onClick={() => remove(b.category)} className="text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-red-400/80">✕</button>
                </div>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className={`h-full ${b.avg_pct >= 100 ? 'bg-red-400/70' : b.avg_pct >= 80 ? 'bg-amber-400/70' : 'bg-emerald-400/70'}`}
                  style={{ width: `${Math.min(100, b.avg_pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <input type="hidden" value={refreshKey} />
    </div>
  );
}

function InsightsSection() {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchInsights = useCallback(async (force = false) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/finance/insights${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setItems(body.insights || []);
      setGeneratedAt(body.generated_at || null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return (
    <div className="rounded-xl border border-blue-400/20 bg-blue-400/[0.04] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-blue-300/85">AI insights</div>
        <button
          onClick={() => fetchInsights(true)}
          disabled={loading}
          className="text-[10px] uppercase tracking-[0.18em] text-blue-300/70 hover:text-blue-300 disabled:opacity-40"
        >
          {loading ? '…' : 'refresh'}
        </button>
      </div>
      {err && <div className="text-[12px] text-red-300">{err}</div>}
      {!err && items.length === 0 && !loading && (
        <div className="text-[12px] text-white/40">Not enough data yet.</div>
      )}
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="text-[13px] leading-relaxed text-white/85">
            · {s}
          </li>
        ))}
      </ul>
      {generatedAt && (
        <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-white/30">
          Updated {new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      )}
    </div>
  );
}

function TransferRow({
  label,
  pct,
  amount,
  tone,
}: {
  label: string;
  pct: number;
  amount: number;
  tone: 'amber' | 'purple' | 'emerald';
}) {
  const toneClasses: Record<typeof tone, string> = {
    amber: 'border-amber-400/30 bg-amber-400/[0.06] text-amber-300',
    purple: 'border-purple-400/30 bg-purple-400/[0.06] text-purple-300',
    emerald: 'border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300',
  };
  return (
    <li className={`flex items-center gap-3 rounded-md border px-3 py-2 ${toneClasses[tone]}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-white/85">{label}</div>
        <div className="num text-[10px] text-white/40">{pct}% of real income</div>
      </div>
      <div className="num text-sm">{fmtMoney(amount)}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Income / vendor leaderboard / recurring bill calendar
// ---------------------------------------------------------------------------

type IncomeBucket = { personal: number; business: number; total: number };
type IncomeResponse = {
  rolling_30d: IncomeBucket;
  this_month: IncomeBucket;
  estimated_monthly: IncomeBucket;
  sample_size: number;
};

function IncomeCard() {
  const [data, setData] = useState<IncomeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/finance/income', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          setErr(`${r.status}`);
          return;
        }
        setData(await r.json());
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-white/40">
        Income unavailable ({err})
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-white/40">
        Loading income…
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
      <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-emerald-300/85">Income</div>
      <ul className="space-y-2">
        <IncomeRow label="Last 30 days" bucket={data.rolling_30d} />
        <IncomeRow label="This month" bucket={data.this_month} />
        <IncomeRow label="Est. monthly (12wk avg)" bucket={data.estimated_monthly} muted />
      </ul>
    </div>
  );
}

function IncomeRow({ label, bucket, muted = false }: { label: string; bucket: IncomeBucket; muted?: boolean }) {
  return (
    <li className={`rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 ${muted ? 'opacity-80' : ''}`}>
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">{label}</div>
        <div className="num text-sm text-emerald-300">{fmtMoney(bucket.total)}</div>
      </div>
      <div className="num mt-1 flex items-baseline gap-3 text-[10px] text-white/45">
        <span><span className="text-white/30">personal</span> {fmtMoney(bucket.personal, { compact: true })}</span>
        <span><span className="text-white/30">business</span> {fmtMoney(bucket.business, { compact: true })}</span>
      </div>
    </li>
  );
}

type VendorRow = { vendor: string; amount: number; count: number; category: string | null; is_business: boolean };

function VendorLeaderboard({ month, scope }: { month: string; scope: string }) {
  const [data, setData] = useState<{ top: VendorRow[]; total: number; rest_count: number; rest_total: number } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ month, scope });
    fetch(`/api/finance/vendor-leaderboard?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [month, scope]);

  if (!data) {
    return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-white/40">Loading vendors…</div>;
  }
  if (data.top.length === 0) {
    return null;
  }
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Top vendors</div>
        <div className="text-[10px] text-white/30">{fmtMonthLong(month)}</div>
      </div>
      <ul className="space-y-0.5">
        {data.top.map((v, i) => {
          const pct = (v.amount / Math.max(data.total, 1)) * 100;
          return (
            <li key={v.vendor + i} className="relative flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
              <div
                className="absolute left-0 top-0 h-full rounded-md bg-emerald-400/[0.06]"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
              <div className="relative min-w-0 flex-1 text-[12px] text-white/85">
                <span className="num mr-2 text-white/30">{String(i + 1).padStart(2, '0')}</span>
                <span className="truncate">{v.vendor}</span>
                {v.is_business && <span className="ml-1.5 text-[9px] uppercase tracking-[0.18em] text-emerald-300/70">biz</span>}
              </div>
              <div className="relative num shrink-0 text-sm text-white/90">{fmtMoney(v.amount)}</div>
              <div className="relative num shrink-0 text-[10px] text-white/30">×{v.count}</div>
            </li>
          );
        })}
      </ul>
      {data.rest_count > 0 && (
        <div className="mt-2 border-t border-white/[0.04] pt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
          +{data.rest_count} more vendors · {fmtMoney(data.rest_total)}
        </div>
      )}
    </div>
  );
}

type RecurringItem = {
  vendor: string;
  expected_day: number;
  expected_amount: number;
  is_business: boolean;
  category: string | null;
  confirmed: boolean;
  months_seen: number;
};

function RecurringCalendar({ month }: { month: string }) {
  const [data, setData] = useState<{ items: RecurringItem[]; total: number } | null>(null);

  useEffect(() => {
    fetch(`/api/finance/recurring-calendar?month=${month}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [month]);

  if (!data) {
    return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[12px] text-white/40">Loading recurring…</div>;
  }
  if (data.items.length === 0) return null;

  // Group by day for collision detection
  const byDay = new Map<number, RecurringItem[]>();
  for (const it of data.items) {
    if (!byDay.has(it.expected_day)) byDay.set(it.expected_day, []);
    byDay.get(it.expected_day)!.push(it);
  }

  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const heaviestDay = Math.max(1, ...Array.from(byDay.values()).map((arr) => arr.reduce((s, i) => s + i.expected_amount, 0)));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Recurring bills</div>
        <div className="text-[10px] text-white/30">{fmtMoney(data.total)} / mo</div>
      </div>

      {/* Compact mini-calendar with bill density per day */}
      <div className="grid grid-cols-7 gap-0.5 sm:grid-cols-10">
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const items = byDay.get(day) || [];
          const dayTotal = items.reduce((s, i) => s + i.expected_amount, 0);
          const intensity = dayTotal / heaviestDay;
          return (
            <div
              key={day}
              title={items.length ? items.map((i) => `${i.vendor}: ${fmtMoney(i.expected_amount)}`).join('\n') : `Day ${day}: clear`}
              className="relative flex h-9 items-center justify-center rounded text-[10px]"
              style={{ background: items.length ? `rgba(245, 158, 11, ${0.10 + intensity * 0.45})` : 'rgba(255,255,255,0.02)' }}
            >
              <span className={items.length ? 'text-amber-100/85 num' : 'num text-white/30'}>{day}</span>
              {items.length > 1 && (
                <span className="absolute right-0.5 top-0.5 num text-[9px] text-amber-300/85">{items.length}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* List view */}
      <ul className="mt-3 space-y-1 text-[11px]">
        {data.items.slice(0, 10).map((it) => (
          <li key={it.vendor} className="flex items-baseline gap-2 rounded-md border border-white/[0.04] bg-black/30 px-2 py-1.5">
            <span className="num shrink-0 text-white/35">{String(it.expected_day).padStart(2, '0')}</span>
            <span className="min-w-0 flex-1 truncate text-white/85">{it.vendor}</span>
            {it.confirmed && <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-emerald-300/70">✓</span>}
            {it.is_business && <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-emerald-300/70">biz</span>}
            <span className="num shrink-0 text-white/70">{fmtMoney(it.expected_amount)}</span>
          </li>
        ))}
        {data.items.length > 10 && (
          <li className="text-[10px] uppercase tracking-[0.18em] text-white/30">+ {data.items.length - 10} more</li>
        )}
      </ul>
    </div>
  );
}
