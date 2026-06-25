import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type BalanceRow = {
  id: string;
  account_id: string;
  as_of_date: string;
  balance: number;
  notes: string | null;
};

type Account = {
  id: string;
  name: string;
  short_name: string | null;
  last_4: string | null;
  type: string;
  category: 'personal' | 'business';
};

/**
 * GET /api/finance/net-worth?days=180
 *
 * Returns a daily net-worth time series over the requested window, plus
 * the latest balance per account and the breakdown by type
 * (cash positive, credit negative).
 *
 * For each day in the window, the net worth uses the most-recent balance
 * snapshot per account on or before that day (carries forward). Credit
 * card accounts are subtracted; cash/checking/savings/other are added.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') || 180), 30), 730);

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  // Pull all balance snapshots in window + a buffer for carry-forward
  const buffer = new Date(since);
  buffer.setDate(buffer.getDate() - 60);
  const { data: balData, error: balErr } = await supabase
    .from('account_balances')
    .select('id, account_id, as_of_date, balance, notes')
    .eq('user_id', USER_ID)
    .gte('as_of_date', buffer.toISOString().slice(0, 10))
    .order('as_of_date', { ascending: true });
  if (balErr) return NextResponse.json({ error: balErr.message }, { status: 500 });
  const balances = (balData || []) as BalanceRow[];

  const { data: accData } = await supabase
    .from('accounts')
    .select('id, name, short_name, last_4, type, category')
    .eq('user_id', USER_ID);
  const accounts = ((accData || []) as Account[]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Walk every day in window and carry-forward each account's latest snapshot
  const latestPerAccount = new Map<string, BalanceRow>();
  for (const b of balances) {
    if (b.as_of_date < sinceStr) {
      const cur = latestPerAccount.get(b.account_id);
      if (!cur || cur.as_of_date < b.as_of_date) latestPerAccount.set(b.account_id, b);
    }
  }

  // Build a per-date map of new snapshots for fast lookup
  const newOnDate = new Map<string, BalanceRow[]>();
  for (const b of balances) {
    if (b.as_of_date >= sinceStr) {
      if (!newOnDate.has(b.as_of_date)) newOnDate.set(b.as_of_date, []);
      newOnDate.get(b.as_of_date)!.push(b);
    }
  }

  const series: { date: string; net_worth: number; cash: number; debt: number }[] = [];
  const cursor = new Date(since);
  const end = new Date();
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const updates = newOnDate.get(dateStr) || [];
    for (const u of updates) latestPerAccount.set(u.account_id, u);

    let cash = 0;
    let debt = 0;
    for (const [accountId, snap] of latestPerAccount) {
      const acc = accountById.get(accountId);
      if (!acc) continue;
      const amt = Number(snap.balance);
      if (acc.type === 'credit') debt += amt; // credit balance = debt
      else cash += amt;
    }
    series.push({
      date: dateStr,
      net_worth: round(cash - debt),
      cash: round(cash),
      debt: round(debt),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Per-account latest snapshot for the breakdown
  const breakdown = Array.from(latestPerAccount.entries())
    .map(([accountId, snap]) => {
      const acc = accountById.get(accountId);
      return {
        account_id: accountId,
        account_name: acc?.short_name || acc?.name || 'Unknown',
        last_4: acc?.last_4 ?? null,
        type: acc?.type ?? 'other',
        category: acc?.category ?? 'personal',
        balance: round(Number(snap.balance)),
        as_of_date: snap.as_of_date,
      };
    })
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const latest = series[series.length - 1] || { net_worth: 0, cash: 0, debt: 0 };
  const first = series[0] || { net_worth: 0 };
  const delta = round(latest.net_worth - first.net_worth);
  return NextResponse.json({
    days,
    current: latest,
    delta_over_window: delta,
    breakdown,
    series,
  });
}

/**
 * POST /api/finance/net-worth — log a balance snapshot for an account.
 * Body: { account_id, as_of_date?, balance, notes? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.account_id || body.balance === undefined) {
    return NextResponse.json({ error: 'account_id and balance required' }, { status: 400 });
  }
  const asOf = typeof body.as_of_date === 'string'
    ? body.as_of_date
    : new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('account_balances')
    .insert({
      user_id: USER_ID,
      account_id: body.account_id,
      as_of_date: asOf,
      balance: Number(body.balance),
      notes: body.notes ?? null,
      source: 'manual',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ balance: data });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
