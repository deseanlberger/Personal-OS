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

export function FinanceDashboard({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/summary?months=12', { cache: 'no-store' });
      if (!res.ok) throw new Error(`summary ${res.status}`);
      const body = (await res.json()) as Summary;
      setData(body);
      setSelectedMonth((cur) => cur || body.this_month.month);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

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

        {/* Transfers to Make */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Transfers to make</div>
            <div className="text-[10px] text-white/30">{fmtMonthLong(shownBucket.month)}</div>
          </div>
          {shownBucket.income === 0 ? (
            <p className="py-6 text-[12px] text-white/30">No income logged this month — log an income transaction (negative amount) to see transfer amounts.</p>
          ) : (
            <ul className="space-y-2">
              <TransferRow label="Tax set-aside" pct={data.transfers.tax.pct} amount={data.transfers.tax.amount} tone="amber" />
              <TransferRow label="Tithe / giving" pct={data.transfers.tithe.pct} amount={data.transfers.tithe.amount} tone="purple" />
              <TransferRow label="Move to savings" pct={data.transfers.savings.pct} amount={data.transfers.savings.amount} tone="emerald" />
              <li className="mt-2 border-t border-white/[0.06] pt-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
                Total to transfer:
                <span className="num ml-1 text-white/80">
                  {fmtMoney(data.transfers.tax.amount + data.transfers.tithe.amount + data.transfers.savings.amount)}
                </span>
                <span className="ml-2 text-white/30 normal-case tracking-normal">
                  ({(data.settings.tax_pct + data.settings.tithe_pct + data.settings.savings_pct).toFixed(0)}% of {fmtMoney(shownBucket.income, { compact: true })})
                </span>
              </li>
            </ul>
          )}
        </div>
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
    </section>
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
