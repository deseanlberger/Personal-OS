import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getMeta, setMeta } from '@/lib/app_meta';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';

const USER_ID = process.env.USER_ID || 'desean';
const CACHE_KEY = 'finance_insights_v1';
const CACHE_TTL_HOURS = 24;

type Txn = {
  txn_date: string;
  amount: number;
  vendor: string | null;
  category: string | null;
  is_business: boolean;
};

/**
 * GET /api/finance/insights?force=1
 *
 * Returns a list of plain-language observations about Desean's spending
 * trends over the last 90 days. Claude reads aggregated monthly category
 * sums (NOT individual transactions — token budget) and emits 5-8
 * bullets. Cached in app_meta for 24 hours to keep costs in check.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === '1';

  const cached = await getMeta(CACHE_KEY);
  if (cached && !force) {
    try {
      const parsed = JSON.parse(cached) as { generated_at: string; insights: string[] };
      const generatedAt = new Date(parsed.generated_at).getTime();
      if (Date.now() - generatedAt < CACHE_TTL_HOURS * 3600 * 1000) {
        return NextResponse.json({ ...parsed, cached: true });
      }
    } catch {
      // fall through to regenerate
    }
  }

  if (!claudeAvailable()) {
    return NextResponse.json({ insights: ['Claude unavailable — set ANTHROPIC_API_KEY.'], generated_at: new Date().toISOString(), cached: false });
  }

  // Pull last 90 days of confirmed transactions
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('txn_date, amount, vendor, category, is_business')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = ((txns || []) as Txn[]).filter((t) => Number(t.amount) > 0);
  if (all.length < 5) {
    return NextResponse.json({
      insights: ['Not enough transaction history yet — log a few more receipts and check back.'],
      generated_at: new Date().toISOString(),
      cached: false,
    });
  }

  // Aggregate: per-month category sums
  type Agg = Record<string, Record<string, number>>; // month -> category -> sum
  const agg: Agg = {};
  for (const t of all) {
    const month = t.txn_date.slice(0, 7);
    const cat = t.category || 'uncategorized';
    if (!agg[month]) agg[month] = {};
    agg[month][cat] = (agg[month][cat] || 0) + Number(t.amount);
  }

  const summaryLines: string[] = [];
  for (const [month, cats] of Object.entries(agg).sort(([a], [b]) => a.localeCompare(b))) {
    const cells = Object.entries(cats)
      .sort(([, a], [, b]) => b - a)
      .map(([c, v]) => `${c}=$${v.toFixed(0)}`)
      .join(', ');
    summaryLines.push(`${month}: ${cells}`);
  }

  // Top vendors over the window
  const vendorMap = new Map<string, number>();
  for (const t of all) {
    if (!t.vendor) continue;
    vendorMap.set(t.vendor, (vendorMap.get(t.vendor) || 0) + Number(t.amount));
  }
  const topVendors = Array.from(vendorMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([v, s]) => `${v}: $${s.toFixed(0)}`)
    .join(', ');

  const prompt = `You are reviewing Desean's last 90 days of spending. Generate 5-8 plain-English observations about trends, surprises, and opportunities.

Per-month category totals:
${summaryLines.join('\n')}

Top vendors: ${topVendors}

Output JSON ONLY:
{ "insights": ["bullet 1", "bullet 2", ...] }

Guidelines:
- Each bullet is one sentence, under 160 chars.
- Surface trends ("eating out climbed from $X to $Y in the last 3 mo").
- Flag outliers ("Software spend doubled — Anthropic + Eleven Labs additions").
- Suggest concrete action only when warranted ("worth reviewing X subscription").
- Don't editorialize about saving more in general — be specific to his data.
- Avoid filler phrases like "It seems that" or "you might want to consider".`;

  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 600,
      system: 'You analyze personal finance data and emit concrete, specific observations as JSON.',
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    if (block?.type !== 'text') throw new Error('No text response');
    const s = block.text.indexOf('{');
    const e = block.text.lastIndexOf('}');
    const parsed = JSON.parse(block.text.slice(s, e + 1)) as { insights: string[] };
    const insights = Array.isArray(parsed.insights) ? parsed.insights.slice(0, 10) : [];
    const result = { insights, generated_at: new Date().toISOString(), cached: false };
    await setMeta(CACHE_KEY, JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
