'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

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
};

type Totals = {
  confirmed_monthly: number;
  likely_monthly: number;
  possible_monthly: number;
  confirmed_annual: number;
  confirmed_business_annual: number;
  confirmed_personal_annual: number;
};

const PALETTE = ['#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#0ea5e9', '#ec4899', '#84cc16', '#facc15', '#ef4444', '#f97316', '#6b7280'];

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function SubscriptionsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [activeSlice, setActiveSlice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/subscription-audit', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setItems(body.items || []);
      setTotals(body.totals || null);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (vendor: string, action: 'confirm' | 'dismiss' | 'reset') => {
    setPending(`${vendor}|${action}`);
    await fetch('/api/finance/subscription-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor, action }),
    });
    setPending(null);
    await load();
  };

  const confirmed = items.filter((i) => i.status === 'confirmed');
  const likely = items.filter((i) => i.status === 'likely_sub');
  const possible = items.filter((i) => i.status === 'possible_sub');
  const dismissed = items.filter((i) => i.status === 'dismissed');

  // Interactive pie data — confirmed subs sorted by monthly cost
  const pieData = confirmed.slice(0, 11).map((c, i) => ({
    vendor: c.vendor,
    amount: c.monthly_cost,
    color: PALETTE[i % PALETTE.length],
  }));
  const pieRest = confirmed.slice(11);
  if (pieRest.length > 0) {
    pieData.push({
      vendor: `+ ${pieRest.length} more`,
      amount: pieRest.reduce((s, c) => s + c.monthly_cost, 0),
      color: '#6b7280',
    });
  }
  const pieTotal = pieData.reduce((s, p) => s + p.amount, 0);
  let angle = -Math.PI / 2;
  const slices = pieData.map((d) => {
    const slice = (d.amount / Math.max(pieTotal, 0.01)) * Math.PI * 2;
    const start = angle;
    const end = angle + slice;
    angle = end;
    return { ...d, start, end, pct: (d.amount / Math.max(pieTotal, 0.01)) * 100 };
  });

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Finance // Subscriptions</h1>
          <p className="mt-1 text-sm text-white/60">Audit every recurring charge. Confirm what&apos;s a real subscription, dismiss the false positives, see what you&apos;re paying for.</p>
        </header>

        {err && <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{err}</div>}

        {totals && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Confirmed / mo" value={totals.confirmed_monthly} tone="emerald" />
            <Stat label="Confirmed / yr" value={totals.confirmed_annual} tone="emerald" />
            <Stat label="Likely pending" value={totals.likely_monthly} tone="amber" sub="/ mo" />
            <Stat label="Possible" value={totals.possible_monthly} tone="white" sub="/ mo" />
          </div>
        )}

        {/* Interactive pie */}
        {confirmed.length > 0 && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/85">Confirmed subscriptions</div>
              <div className="num text-[10px] text-white/40">{fmt(pieTotal)} / mo</div>
            </div>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <svg viewBox="0 0 240 240" className="size-56 shrink-0">
                {slices.map((s, i) => {
                  const path = arcPath(120, 120, 100, 60, s.start, s.end);
                  const active = activeSlice === s.vendor;
                  return (
                    <path
                      key={i}
                      d={path}
                      fill={s.color}
                      opacity={active ? 1 : activeSlice ? 0.35 : 0.9}
                      onMouseEnter={() => setActiveSlice(s.vendor)}
                      onMouseLeave={() => setActiveSlice(null)}
                      onClick={() => setActiveSlice((cur) => cur === s.vendor ? null : s.vendor)}
                      style={{ cursor: 'pointer', transition: 'opacity 120ms' }}
                    />
                  );
                })}
                <circle cx="120" cy="120" r="55" fill="#0a0a0a" />
                <text x="120" y="115" textAnchor="middle" fontSize="9" fill="#6b7280" style={{ textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                  {activeSlice || 'TOTAL'}
                </text>
                <text x="120" y="135" textAnchor="middle" fontSize="14" fill="#e5e7eb" className="num">
                  {activeSlice
                    ? fmt(slices.find((s) => s.vendor === activeSlice)?.amount || 0)
                    : `$${(pieTotal / 1000 >= 1 ? (pieTotal / 1000).toFixed(1) + 'k' : pieTotal.toFixed(0))}`}
                </text>
              </svg>
              <ul className="flex-1 space-y-1">
                {slices.map((s) => (
                  <li
                    key={s.vendor}
                    onMouseEnter={() => setActiveSlice(s.vendor)}
                    onMouseLeave={() => setActiveSlice(null)}
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] transition ${activeSlice === s.vendor ? 'bg-white/[0.05]' : ''}`}
                  >
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate text-white/80">{s.vendor}</span>
                    <span className="num shrink-0 text-white/55">{fmt(s.amount)}</span>
                    <span className="num w-10 shrink-0 text-right text-white/30">{s.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <SubList title={`Likely subscriptions · ${likely.length}`} items={likely} act={act} pending={pending} tone="amber" />
        <SubList title={`Confirmed · ${confirmed.length}`} items={confirmed} act={act} pending={pending} tone="emerald" />
        <SubList title={`Possible · ${possible.length}`} items={possible} act={act} pending={pending} tone="white" />
        <SubList title={`Dismissed · ${dismissed.length}`} items={dismissed} act={act} pending={pending} tone="muted" />
      </div>
    </Shell>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone: 'emerald' | 'amber' | 'white'; sub?: string }) {
  const color = tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-white/85';
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</div>
      <div className={`num mt-1 text-2xl ${color}`}>{fmt(value)}{sub && <span className="ml-1 text-[10px] text-white/40">{sub}</span>}</div>
    </div>
  );
}

function SubList({ title, items, act, pending, tone }: { title: string; items: Item[]; act: (v: string, a: 'confirm' | 'dismiss' | 'reset') => void; pending: string | null; tone: 'emerald' | 'amber' | 'white' | 'muted' }) {
  if (items.length === 0) return null;
  const headerTone =
    tone === 'emerald' ? 'text-emerald-300/85' :
    tone === 'amber' ? 'text-amber-300/85' :
    tone === 'muted' ? 'text-white/35' :
    'text-white/50';
  return (
    <section>
      <h2 className={`mb-2 text-[10px] uppercase tracking-[0.18em] ${headerTone}`}>{title}</h2>
      <div className="space-y-1">
        {items.map((i) => (
          <div key={i.vendor} className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm text-white/85">{i.vendor}</span>
                {i.is_business && <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-400/10 px-1 py-0.5 text-[9px] uppercase tracking-[0.14em] text-emerald-300">biz</span>}
                {i.category && <span className="shrink-0 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[9px] text-white/60">{i.category}</span>}
              </div>
              <div className="num mt-0.5 text-[10px] text-white/40">
                {i.months_seen} mo seen · last {fmt(i.last_amount)} on {i.last_date}
              </div>
            </div>
            <div className="text-right">
              <div className="num text-sm text-white/85">{fmt(i.monthly_cost)}</div>
              <div className="num text-[10px] text-white/35">{fmt(i.annual_cost)}/yr</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {i.status !== 'confirmed' && (
                <button
                  disabled={pending === `${i.vendor}|confirm`}
                  onClick={() => act(i.vendor, 'confirm')}
                  className="rounded-md border border-emerald-400/40 bg-emerald-400/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40"
                >
                  Sub
                </button>
              )}
              {i.status !== 'dismissed' && (
                <button
                  disabled={pending === `${i.vendor}|dismiss`}
                  onClick={() => act(i.vendor, 'dismiss')}
                  className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white/65 hover:bg-white/[0.10] disabled:opacity-40"
                >
                  Not
                </button>
              )}
              {(i.status === 'confirmed' || i.status === 'dismissed') && (
                <button
                  disabled={pending === `${i.vendor}|reset`}
                  onClick={() => act(i.vendor, 'reset')}
                  className="rounded-md px-1 text-[14px] text-white/30 hover:text-white/65 disabled:opacity-40"
                  title="Reset to pending"
                >
                  ↺
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Build the SVG path for a donut slice
function arcPath(cx: number, cy: number, outerR: number, innerR: number, start: number, end: number): string {
  const x1 = cx + outerR * Math.cos(start);
  const y1 = cy + outerR * Math.sin(start);
  const x2 = cx + outerR * Math.cos(end);
  const y2 = cy + outerR * Math.sin(end);
  const x3 = cx + innerR * Math.cos(end);
  const y3 = cy + innerR * Math.sin(end);
  const x4 = cx + innerR * Math.cos(start);
  const y4 = cy + innerR * Math.sin(start);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return [`M ${x1} ${y1}`, `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`, `L ${x3} ${y3}`, `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`, 'Z'].join(' ');
}
