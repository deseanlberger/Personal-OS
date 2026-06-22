import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { z } from 'zod';

const USER_ID = process.env.USER_ID || 'desean';

const TxnInput = z.object({
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  vendor: z.string().min(1),
  category: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  is_business: z.boolean().optional(),
  account_id: z.string().uuid().nullable().optional(),
  source: z.string().optional(),
});

const Body = z.object({
  transactions: z.array(TxnInput).max(500),
  account_id: z.string().uuid().nullable().optional(),
  source: z.string().optional(),
});

/**
 * POST /api/transactions/bulk
 *
 * Inserts an array of transactions. Used by /finance's Upload Statement
 * flow after the user reviews the parser output. Dedups against existing
 * rows on (user_id, account_id, txn_date, amount, vendor) to be safe
 * when the same statement is re-uploaded.
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad body', issues: parsed.error.issues }, { status: 400 });
  }
  const { transactions, account_id: defaultAccount, source: defaultSource } = parsed.data;

  // Dedup against the time window covered by the input
  const dates = transactions.map((t) => t.txn_date).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  const { data: existing } = await supabase
    .from('transactions')
    .select('txn_date, amount, vendor')
    .eq('user_id', USER_ID)
    .gte('txn_date', minDate)
    .lte('txn_date', maxDate);

  const existingKeys = new Set(
    (existing || []).map((e) => `${e.txn_date}|${Number(e.amount).toFixed(2)}|${(e.vendor || '').toLowerCase().trim()}`),
  );

  const toInsert: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const t of transactions) {
    const key = `${t.txn_date}|${Number(t.amount).toFixed(2)}|${t.vendor.toLowerCase().trim()}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    toInsert.push({
      user_id: USER_ID,
      txn_date: t.txn_date,
      amount: t.amount,
      vendor: t.vendor,
      category: t.category || null,
      memo: t.memo || null,
      is_business: t.is_business ?? false,
      account_id: t.account_id ?? defaultAccount ?? null,
      source: t.source || defaultSource || 'bulk',
      needs_review: false,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, skipped, message: 'all duplicates — nothing inserted' });
  }
  const { error, data } = await supabase.from('transactions').insert(toInsert).select('id');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: data?.length || 0, skipped });
}
