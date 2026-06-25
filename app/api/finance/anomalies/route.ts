import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

type Txn = {
  txn_date: string;
  amount: number;
  category: string | null;
  vendor: string | null;
  is_business: boolean;
};

/**
 * GET /api/finance/anomalies?threshold=2
 *
 * Flags categories where spend in the last 7 days is `threshold`× the
 * 4-week trailing weekly average (excluding the current week, so a single
 * heavy week doesn't normalize itself away).
 *
 * Threshold default 2.0. Set lower (e.g. 1.5) for noisier alerts.
 *
 * Also surfaces vendor-level anomalies: any single charge >3× the 90-day
 * average for that vendor.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threshold = Math.max(1.1, Number(searchParams.get('threshold') || 2));

  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 35); // 5 weeks

  const { data, error } = await supabase
    .from('transactions')
    .select('txn_date, amount, category, vendor, is_business')
    .eq('user_id', USER_ID)
    .eq('needs_review', false)
    .gt('amount', 0)
    .gte('txn_date', since.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const txns = (data || []) as Txn[];

  // --- Category-level: this week vs prior 4-week avg ---
  const cutoff7 = new Date(today);
  cutoff7.setDate(cutoff7.getDate() - 7);
  const cutoff7Str = cutoff7.toISOString().slice(0, 10);
  const cutoff35Str = since.toISOString().slice(0, 10);

  const thisWeekByCat = new Map<string, number>();
  const priorWeeksByCat = new Map<string, number>();
  for (const t of txns) {
    const cat = t.category || 'uncategorized';
    const amt = Number(t.amount);
    if (t.txn_date >= cutoff7Str) {
      thisWeekByCat.set(cat, (thisWeekByCat.get(cat) || 0) + amt);
    } else if (t.txn_date >= cutoff35Str) {
      priorWeeksByCat.set(cat, (priorWeeksByCat.get(cat) || 0) + amt);
    }
  }

  const categoryAlerts: { category: string; this_week: number; weekly_avg: number; ratio: number }[] = [];
  for (const [cat, thisWeek] of thisWeekByCat) {
    const priorTotal = priorWeeksByCat.get(cat) || 0;
    const weeklyAvg = priorTotal / 4;
    if (weeklyAvg < 5) continue; // ignore tiny categories — noise
    if (thisWeek < 25) continue; // ignore trivial-dollar alerts
    const ratio = thisWeek / weeklyAvg;
    if (ratio >= threshold) {
      categoryAlerts.push({
        category: cat,
        this_week: round(thisWeek),
        weekly_avg: round(weeklyAvg),
        ratio: round(ratio),
      });
    }
  }
  categoryAlerts.sort((a, b) => b.ratio - a.ratio);

  // --- Vendor-level: single charge >3× the vendor's 90-day average ---
  type VendorAgg = { amounts: number[]; vendor: string };
  const vendorMap = new Map<string, VendorAgg>();
  for (const t of txns) {
    if (!t.vendor) continue;
    const key = t.vendor.trim().toLowerCase();
    if (!vendorMap.has(key)) vendorMap.set(key, { amounts: [], vendor: t.vendor.trim() });
    vendorMap.get(key)!.amounts.push(Number(t.amount));
  }
  const vendorAlerts: { vendor: string; amount: number; avg: number; ratio: number; date: string }[] = [];
  for (const t of txns) {
    if (!t.vendor) continue;
    if (t.txn_date < cutoff7Str) continue;
    const key = t.vendor.trim().toLowerCase();
    const agg = vendorMap.get(key);
    if (!agg || agg.amounts.length < 3) continue;
    const avg = agg.amounts.reduce((s, n) => s + n, 0) / agg.amounts.length;
    if (avg < 5) continue;
    const amt = Number(t.amount);
    if (amt < 25) continue;
    const ratio = amt / avg;
    if (ratio >= 3) {
      vendorAlerts.push({
        vendor: agg.vendor,
        amount: round(amt),
        avg: round(avg),
        ratio: round(ratio),
        date: t.txn_date,
      });
    }
  }
  vendorAlerts.sort((a, b) => b.ratio - a.ratio);

  return NextResponse.json({
    threshold,
    category_alerts: categoryAlerts,
    vendor_alerts: vendorAlerts.slice(0, 10),
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
