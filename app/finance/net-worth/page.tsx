'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';

type SeriesPoint = { date: string; net_worth: number; cash: number; debt: number };
type BreakdownRow = {
  account_id: string;
  account_name: string;
  last_4: string | null;
  type: string;
  category: 'personal' | 'business';
  balance: number;
  as_of_date: string;
};
type Response = {
  current: { net_worth: number; cash: number; debt: number };
  delta_over_window: number;
  breakdown: BreakdownRow[];
  series: SeriesPoint[];
  days: number;
};
type Account = { id: string; name: string; short_name: string | null; last_4: string | null; type: string; category: 'personal' | 'business' };

function fmtMoney(n: number, opts: { compact?: boolean; sign?: boolean } = {}) {
  const sign = opts.sign && n > 0 ? '+' : n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (opts.compact && v >= 1000) return `${sign}$${(v / 1000).toFixed(1)}k`;
  return `${sign}$${v.toFixed(2)}`;
}

export default function NetWorthPage() {
  const [data, setData] = useState<Response | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(180);

  const load = useCallback(async () => {
    try {
      const [nwRes, accRes] = await Promise.all([
        fetch(`/api/finance/net-worth?days=${days}`, { cache: 'no-store' }),
        fetch('/api/accounts', { cache: 'no-store' }),
      ]);
      if (!nwRes.ok) throw new Error(`${nwRes.status}`);
      const body = await nwRes.json();
      setData(body);
      if (accRes.ok) {
        const accBody = await accRes.json();
        setAccounts(accBody.accounts || []);
      }
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Finance // Net Worth</h1>
            <p className="mt-1 text-sm text-white/60">Snapshot balances every week or two. The line grows over time.</p>
          </div>
          <div className="flex items-center rounded-md border border-white/10 bg-black/30 p-0.5">
            {[90, 180, 365].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition ${days === d ? 'bg-white/[0.10] text-white/85' : 'text-white/40 hover:text-white/65'}`}>
                {d}d
              </button>
            ))}
          </div>
        </header>

        {err && <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{err}</div>}

        <SnapshotForm accounts={accounts} onSaved={load} />

        {data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card label="Net worth" value={fmtMoney(data.current.net_worth)} tone="emerald" sub={fmtMoney(data.delta_over_window, { sign: true }) + ` over ${data.days}d`} />
              <Card label="Cash & savings" value={fmtMoney(data.current.cash)} tone="white" />
              <Card label="Credit debt" value={fmtMoney(data.current.debt)} tone="red" />
            </div>

            <NetWorthChart series={data.series} />

            {data.breakdown.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">Account balances</h2>
                <div className="space-y-1">
                  {data.breakdown.map((b) => (
                    <div key={b.account_id} className="flex items-baseline gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white/85">{b.account_name}{b.last_4 ? <span className="ml-1 num text-white/40">····{b.last_4}</span> : null}</div>
                        <div className="num mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/40">{b.type} · {b.category} · as of {b.as_of_date}</div>
                      </div>
                      <div className={`num text-sm ${b.type === 'credit' ? 'text-red-300' : 'text-emerald-300'}`}>{fmtMoney(b.balance)}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

function Card({ label, value, tone, sub }: { label: string; value: string; tone: 'emerald' | 'white' | 'red'; sub?: string }) {
  const color = tone === 'emerald' ? 'text-emerald-300' : tone === 'red' ? 'text-red-300' : 'text-white/90';
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</div>
      <div className={`num mt-1 text-2xl ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-white/40">{sub}</div>}
    </div>
  );
}

function NetWorthChart({ series }: { series: SeriesPoint[] }) {
  if (series.length === 0) return null;
  const max = Math.max(...series.map((s) => s.net_worth));
  const min = Math.min(...series.map((s) => s.net_worth));
  const range = Math.max(max - min, 1);
  const w = 720;
  const h = 200;
  const pad = 20;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const stepX = innerW / Math.max(series.length - 1, 1);
  const points = series.map((s, i) => {
    const x = pad + i * stepX;
    const y = pad + innerH - ((s.net_worth - min) / range) * innerH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">Net worth over time</div>
        <div className="num text-[10px] text-white/30">{series[0].date} → {series[series.length - 1].date}</div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <polyline points={points} fill="none" stroke="#10b981" strokeWidth="2" />
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#ffffff14" />
      </svg>
    </div>
  );
}

function SnapshotForm({ accounts, onSaved }: { accounts: Account[]; onSaved: () => Promise<void> | void }) {
  const [accountId, setAccountId] = useState('');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState(false);
  if (accounts.length === 0) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(balance);
    if (!accountId || !Number.isFinite(n)) return;
    setPending(true);
    await fetch('/api/finance/net-worth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, balance: n, as_of_date: date }),
    });
    setBalance('');
    setPending(false);
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 sm:grid-cols-4">
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/85 outline-none">
        <option value="">— Account —</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.short_name || a.name}{a.last_4 ? ` ····${a.last_4}` : ''}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="num rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/85 outline-none" />
      <input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="Balance ($)" className="num rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white/85 outline-none" />
      <button type="submit" disabled={!accountId || !balance || pending} className="min-h-9 rounded-md border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-40">
        {pending ? 'Saving…' : '+ Snapshot'}
      </button>
    </form>
  );
}
