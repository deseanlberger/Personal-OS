import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getMeta, setMeta } from '@/lib/app_meta';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';

const USER_ID = process.env.USER_ID || 'desean';
const CACHE_KEY = 'finance_savings_recs_v1';
const CACHE_TTL_HOURS = 24;

/**
 * GET /api/finance/savings-recs?force=1
 *
 * Looks at the last 90 days of confirmed transactions and asks Claude to
 * surface 4-6 specific, actionable savings opportunities — focused on
 * subscriptions, recurring vendors, and high-spend categories that have
 * realistic room to cut. Each rec includes an estimated monthly savings
 * number so they're sortable. Cached 24h to keep costs reasonable.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === '1';

  const cached = await getMeta(CACHE_KEY);
  if (cached && !force) {
    try {
      const parsed = JSON.parse(cached) as { generated_at: string; recs: Rec[] };
      const generatedAt = new Date(parsed.generated_at).getTime();
      if (Date.now() - generatedAt < CACHE_TTL_HOURS * 3600 * 1000) {
        return NextResponse.json({ ...parsed, cached: true });
      }
    } catch {
      // regenerate
    }
  }

  if (!claudeAvailable()) {
    return NextResponse.json({
      recs: [],
      generated_at: new Date().toISOString(),
      cached: false,
      error: 'ANTHROPIC_API_KEY not set',
    });
  }

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('txn_date, amount, vendor, category, is_business')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Txn = {
    txn_date: string;
    amount: number;
    vendor: string | null;
    category: string | null;
    is_business: boolean;
  };
  const all = (txns || []) as Txn[];
  if (all.length < 10) {
    return NextResponse.json({
      recs: [],
      generated_at: new Date().toISOString(),
      cached: false,
      note: 'Need more transaction history before recs make sense.',
    });
  }

  // Per-vendor monthly spend (best signal for subscriptions): count distinct
  // months a vendor appears + average amount. A vendor seen in 2+ of the last
  // 3 months with consistent amounts is almost always recurring.
  type V = { months: Set<string>; sum: number; count: number; biz: number };
  const vendorMap = new Map<string, V>();
  for (const t of all) {
    const v = (t.vendor || 'unknown').trim();
    if (!vendorMap.has(v)) vendorMap.set(v, { months: new Set(), sum: 0, count: 0, biz: 0 });
    const row = vendorMap.get(v)!;
    row.months.add(t.txn_date.slice(0, 7));
    row.sum += Number(t.amount);
    row.count++;
    if (t.is_business) row.biz += Number(t.amount);
  }

  const recurringVendors = Array.from(vendorMap.entries())
    .filter(([, v]) => v.months.size >= 2 && v.count >= 2)
    .map(([name, v]) => ({
      vendor: name,
      monthly_est: Math.round(v.sum / Math.max(v.months.size, 1)),
      total_90d: Math.round(v.sum),
      months_seen: v.months.size,
      biz_pct: v.sum > 0 ? Math.round((v.biz / v.sum) * 100) : 0,
    }))
    .sort((a, b) => b.monthly_est - a.monthly_est)
    .slice(0, 25);

  // Category totals (90d)
  const catMap = new Map<string, number>();
  for (const t of all) {
    const c = t.category || 'uncategorized';
    catMap.set(c, (catMap.get(c) || 0) + Number(t.amount));
  }
  const topCats = Array.from(catMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([c, s]) => ({ category: c, total_90d: Math.round(s), monthly_avg: Math.round(s / 3) }));

  const prompt = `You're helping Desean find SPECIFIC ways to cut spending. He's a personal trainer/coach who tracks personal + business expenses together. Return 4-6 actionable recommendations.

Top recurring vendors (last 90d, sorted by monthly estimate):
${recurringVendors.map((r) => `- ${r.vendor}: ~$${r.monthly_est}/mo (seen in ${r.months_seen} months, ${r.biz_pct}% business)`).join('\n')}

Top categories (last 90d):
${topCats.map((c) => `- ${c.category}: $${c.total_90d} total, ~$${c.monthly_avg}/mo`).join('\n')}

Output JSON ONLY:
{
  "recs": [
    {
      "title": "Short imperative title — e.g. 'Cancel duplicate streaming'",
      "detail": "1-2 sentences explaining what to look at and why",
      "monthly_savings": 18,
      "category": "subscription" | "category_cut" | "vendor_switch" | "other",
      "vendor": "vendor name if applicable, else null"
    }
  ]
}

Rules:
- Sort by monthly_savings descending.
- Be SPECIFIC — name the vendor or category, not "save more on food".
- Don't recommend cutting things that look like core ops (gym software, business POS, fuel for a coach who drives to clients).
- Skip recs under $5/mo savings.
- Prefer concrete duplicates ("two music streaming subs") over vague trims.
- monthly_savings must be a realistic number, not aspirational.`;

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 1200,
      system: 'You suggest concrete, specific savings opportunities from personal finance data. Output strict JSON.',
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    if (block?.type !== 'text') throw new Error('No text response');
    const s = block.text.indexOf('{');
    const e = block.text.lastIndexOf('}');
    const parsed = JSON.parse(block.text.slice(s, e + 1)) as { recs: Rec[] };
    const recs = Array.isArray(parsed.recs)
      ? parsed.recs
          .filter((r) => r && typeof r.title === 'string' && typeof r.monthly_savings === 'number')
          .sort((a, b) => b.monthly_savings - a.monthly_savings)
          .slice(0, 8)
      : [];
    const result = { recs, generated_at: new Date().toISOString(), cached: false };
    await setMeta(CACHE_KEY, JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

type Rec = {
  title: string;
  detail: string;
  monthly_savings: number;
  category: 'subscription' | 'category_cut' | 'vendor_switch' | 'other';
  vendor: string | null;
};
