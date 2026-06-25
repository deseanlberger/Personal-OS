import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/finance/budgets/suggest
 *
 * Looks at the prior 30 days of confirmed spending and returns one
 * suggested monthly budget per category. The number is the actual 30-day
 * total + a 10% cushion (round up to the nearest $5) so the budget is
 * realistic, not aspirational. Excludes categories with <$10 of spend.
 */
export async function GET() {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);

  const { data, error } = await supabase
    .from('transactions')
    .select('category, amount, is_business')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', cutoff.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { category: string | null; amount: number; is_business: boolean };
  const rows = (data || []) as Row[];

  const byCat = new Map<string, { spent: number; biz_share: number; count: number }>();
  for (const r of rows) {
    const cat = r.category || 'uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, { spent: 0, biz_share: 0, count: 0 });
    const b = byCat.get(cat)!;
    b.spent += Number(r.amount);
    b.count++;
    if (r.is_business) b.biz_share += Number(r.amount);
  }

  // Pull existing budgets to mark which are already set
  const { data: existing } = await supabase
    .from('category_budgets')
    .select('category, monthly_amount')
    .eq('user_id', USER_ID);
  const existingMap = new Map<string, number>(
    (existing || []).map((e) => [e.category as string, Number(e.monthly_amount)]),
  );

  const suggestions = Array.from(byCat.entries())
    .map(([category, b]) => {
      const cushion = b.spent * 1.1;
      const suggested = Math.ceil(cushion / 5) * 5; // round up to nearest $5
      return {
        category,
        last_30d: round(b.spent),
        suggested,
        biz_share_pct: b.spent > 0 ? Math.round((b.biz_share / b.spent) * 100) : 0,
        existing: existingMap.get(category) ?? null,
        count: b.count,
      };
    })
    .filter((s) => s.last_30d >= 10)
    .sort((a, b) => b.last_30d - a.last_30d);

  return NextResponse.json({ suggestions });
}

/**
 * POST /api/finance/budgets/suggest
 * Body: { categories: string[] }
 *
 * Bulk-applies the suggested budgets for the listed categories by computing
 * the same number server-side and upserting into category_budgets. Idempotent.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.categories)) {
    return NextResponse.json({ error: 'categories array required' }, { status: 400 });
  }

  // Recompute the suggestions on the server (don't trust the client's numbers)
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);

  const { data, error } = await supabase
    .from('transactions')
    .select('category, amount')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', cutoff.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byCat = new Map<string, number>();
  for (const r of (data || []) as { category: string | null; amount: number }[]) {
    const cat = r.category || 'uncategorized';
    byCat.set(cat, (byCat.get(cat) || 0) + Number(r.amount));
  }

  const upserts: { user_id: string; category: string; monthly_amount: number }[] = [];
  for (const cat of body.categories as string[]) {
    const spent = byCat.get(cat) || 0;
    if (spent < 10) continue;
    const suggested = Math.ceil((spent * 1.1) / 5) * 5;
    upserts.push({ user_id: USER_ID, category: cat, monthly_amount: suggested });
  }
  if (upserts.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const { error: upErr } = await supabase
    .from('category_budgets')
    .upsert(upserts, { onConflict: 'user_id,category' });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, applied: upserts.length });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
