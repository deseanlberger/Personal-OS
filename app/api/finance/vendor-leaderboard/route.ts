import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/finance/vendor-leaderboard?month=YYYY-MM&scope=personal|business|all
 *
 * Top vendors by spend for the requested month, deduped by trimmed/lowercased
 * vendor name. Returns the top 15 + a "rest of vendors" row so the UI can
 * collapse the long tail without misleading totals.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const scope = (searchParams.get('scope') || 'all').toLowerCase();

  let query = supabase
    .from('transactions')
    .select('vendor, amount, is_business, category')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', `${month}-01`)
    .lt('txn_date', nextMonthIso(month));
  if (scope === 'personal') query = query.eq('is_business', false);
  else if (scope === 'business') query = query.eq('is_business', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { vendor: string | null; amount: number; is_business: boolean; category: string | null };
  const rows = (data || []) as Row[];

  const byVendor = new Map<string, { vendor: string; amount: number; count: number; category: string | null; is_business: boolean }>();
  for (const r of rows) {
    const key = (r.vendor || '(no vendor)').trim().toLowerCase();
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        vendor: (r.vendor || '(no vendor)').trim(),
        amount: 0,
        count: 0,
        category: r.category,
        is_business: r.is_business,
      });
    }
    const b = byVendor.get(key)!;
    b.amount += Number(r.amount);
    b.count++;
  }

  const all = Array.from(byVendor.values()).sort((a, b) => b.amount - a.amount);
  const top = all.slice(0, 15).map((v) => ({ ...v, amount: round(v.amount) }));
  const rest = all.slice(15);
  const restTotal = rest.reduce((s, v) => s + v.amount, 0);
  const total = all.reduce((s, v) => s + v.amount, 0);

  return NextResponse.json({
    month,
    scope,
    total: round(total),
    top,
    rest_count: rest.length,
    rest_total: round(restTotal),
  });
}

function nextMonthIso(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 1); // overflow into next month
  return d.toISOString().slice(0, 10);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
