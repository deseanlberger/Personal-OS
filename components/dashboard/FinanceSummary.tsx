'use client';

import { useCallback, useEffect, useState } from 'react';

type MonthBucket = { month: string; personal: number; business: number; total: number; count: number };
type CatBucket = { category: string; amount: number; count: number };
type AcctBucket = { account_id: string | null; account_name: string; account_short: string | null; amount: number; count: number };
type VendorBucket = { vendor: string; amount: number; count: number };

type Summary = {
  months: number;
  totals_by_month: MonthBucket[];
  by_category: CatBucket[];
  by_account: AcctBucket[];
  by_vendor: VendorBucket[];
  this_month: MonthBucket;
  last_month: MonthBucket;
  month_over_month_pct: number | null;
  total_transactions: number;
  total_spend: number;
};

const CATEGORY_TONE: Record<string, string> = {
  food: 'bg-amber-300/70',
  gas: 'bg-orange-400/70',
  supplements: 'bg-emerald-400/70',
  'athlete-fees': 'bg-blue-400/70',
  rent: 'bg-purple-400/70',
  software: 'bg-sky-400/70',
  travel: 'bg-pink-400/70',
  'gym-equipment': 'bg-emerald-500/70',
  office: 'bg-white/40',
  medical: 'bg-red-400/70',
  other: 'bg-white/25',
  uncategorized: 'bg-white/20',
};

function fmtMoney(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}k`;
  }
  return `$${n.toFixed(2)}`;
}

function fmtMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function fmtMonthShort(monthKey: string): string {
  const [, m] = monthKey.split('-').map(Number);
  const d = new Date(2000, (m || 1) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short' });
}

export function FinanceSummary({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<Summary | null>(null);
  const [months, setMonths] = useState(6);
  const [err, setErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/finance/summary?months=${months}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`summary ${res.status}`);
      const body = (await res.json()) as Summary;
      setData(body);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [months]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey]);

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
        Loading summary…
      </section>
    );
  }

  if (data.total_transactions === 0) {
    return null;
  }

  const maxMonthTotal = Math.max(...data.totals_by_month.map((m) => m.total), 1);
  const maxCategoryAmount = Math.max(...data.by_category.map((c) => c.amount), 1);
  const maxAccountAmount = Math.max(...data.by_account.map((a) => a.amount), 1);

  const momPct = data.month_over_month_pct;
  const momTone = momPct === null ? 'text-white/40' : momPct > 0 ? 'text-amber-300' : 'text-emerald-300';

  return (
    <section className="space-y-5">
      {/* Top stats: this month / last month / total in window */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">This month</div>
          <div className="num mt-1 text-2xl text-white/90">{fmtMoney(data.this_month.total)}</div>
          <div className="mt-1 text-[10px] text-white/40">
            {data.this_month.count} txns · {fmtMoney(data.this_month.personal, { compact: true })} pers ·{' '}
            <span className="text-emerald-300/80">{fmtMoney(data.this_month.business, { compact: true })} biz</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Last month</div>
          <div className="num mt-1 text-2xl text-white/85">{fmtMoney(data.last_month.total)}</div>
          {momPct !== null && (
            <div className={`mt-1 text-[10px] num ${momTone}`}>
              {momPct > 0 ? '▲' : '▼'} {Math.abs(momPct).toFixed(1)}% vs this month
            </div>
          )}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Last {months} mo</div>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-white/70 outline-none"
            >
              {[3, 6, 12, 24].map((n) => (
                <option key={n} value={n}>
                  {n}mo
                </option>
              ))}
            </select>
          </div>
          <div className="num mt-1 text-2xl text-white/85">{fmtMoney(data.total_spend, { compact: true })}</div>
          <div className="mt-1 text-[10px] text-white/40">{data.total_transactions} total txns</div>
        </div>
      </div>

      {/* By month — vertical bar chart with personal/business split */}
      {data.totals_by_month.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-white/50">By month · {months} months</div>
          <div className="flex h-40 items-end gap-2">
            {data.totals_by_month.map((m) => {
              const hPct = (m.total / maxMonthTotal) * 100;
              const personalPct = m.total > 0 ? (m.personal / m.total) * 100 : 0;
              const businessPct = m.total > 0 ? (m.business / m.total) * 100 : 0;
              const isCurrentMonth = m.month === data.this_month.month;
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="num text-[9px] text-white/40">{fmtMoney(m.total, { compact: true })}</div>
                  <div className="relative flex w-full flex-1 items-end">
                    <div
                      className="relative flex w-full flex-col overflow-hidden rounded-t"
                      style={{ height: `${Math.max(hPct, 2)}%` }}
                    >
                      <div className="bg-emerald-400/70" style={{ height: `${businessPct}%` }} />
                      <div className="bg-white/40" style={{ height: `${personalPct}%` }} />
                    </div>
                  </div>
                  <div
                    className={`text-[10px] uppercase tracking-[0.14em] ${
                      isCurrentMonth ? 'text-emerald-300' : 'text-white/45'
                    }`}
                  >
                    {fmtMonthShort(m.month)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-white/40" /> personal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-emerald-400/70" /> business
            </span>
          </div>
        </div>
      )}

      {/* By category — horizontal bars */}
      {data.by_category.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-white/50">By category</div>
          <ul className="space-y-2">
            {data.by_category.map((c) => {
              const pct = (c.amount / maxCategoryAmount) * 100;
              const tone = CATEGORY_TONE[c.category] || CATEGORY_TONE.other;
              return (
                <li key={c.category} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 truncate text-[11px] uppercase tracking-[0.14em] text-white/65">
                    {c.category}
                  </div>
                  <div className="relative flex-1">
                    <div className="h-5 overflow-hidden rounded-sm bg-white/[0.04]">
                      <div className={`h-full rounded-sm ${tone}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="num w-20 shrink-0 text-right text-[11px] text-white/85">{fmtMoney(c.amount)}</div>
                  <div className="num w-10 shrink-0 text-right text-[10px] text-white/35">{c.count}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* By account + Top vendors side by side */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data.by_account.length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-white/50">By account</div>
            <ul className="space-y-2">
              {data.by_account.map((a) => {
                const pct = (a.amount / maxAccountAmount) * 100;
                return (
                  <li key={a.account_id || 'unassigned'} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 truncate text-[11px] text-white/65">
                      {a.account_short || a.account_name}
                    </div>
                    <div className="relative flex-1">
                      <div className="h-3 overflow-hidden rounded-sm bg-white/[0.04]">
                        <div className="h-full rounded-sm bg-sky-400/60" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="num w-20 shrink-0 text-right text-[11px] text-white/85">{fmtMoney(a.amount)}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {data.by_vendor.length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-white/50">Top vendors</div>
            <ul className="space-y-1.5">
              {data.by_vendor.map((v) => (
                <li key={v.vendor} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[12px] text-white/80">{v.vendor}</div>
                  <div className="flex shrink-0 items-baseline gap-2">
                    <span className="num text-[10px] text-white/30">{v.count}×</span>
                    <span className="num text-[12px] text-white/85">{fmtMoney(v.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
