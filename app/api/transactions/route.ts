import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Number(searchParams.get('days') || 30), 365);
  const status = searchParams.get('status'); // 'pending' | 'confirmed' | null = all
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabase
    .from('transactions')
    .select('*, account:accounts(id,name,short_name,last_4,category,type)')
    .eq('user_id', USER_ID)
    .gte('txn_date', since.toISOString().slice(0, 10))
    .order('txn_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);

  if (status === 'pending') query = query.eq('needs_review', true);
  else if (status === 'confirmed') query = query.eq('needs_review', false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transactions: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (!body.txn_date || typeof body.amount !== 'number') {
    return NextResponse.json({ error: 'txn_date + amount required' }, { status: 400 });
  }

  const source = body.source || 'manual';
  // Photo/gmail/sheet imports default to needs_review = true. Manual entries
  // are user-confirmed at the moment of entry, so they go straight to confirmed.
  const autoPending = source === 'photo' || source === 'gmail' || source === 'sheet_import';
  const needsReview =
    typeof body.needs_review === 'boolean' ? body.needs_review : autoPending;

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: USER_ID,
      account_id: body.account_id || null,
      txn_date: body.txn_date,
      amount: body.amount,
      vendor: body.vendor || null,
      category: body.category || null,
      memo: body.memo || null,
      is_business: !!body.is_business,
      source,
      receipt_image_url: body.receipt_image_url || null,
      raw_parse: body.raw_parse || null,
      needs_review: needsReview,
    })
    .select('*, account:accounts(id,name,short_name,last_4,category,type)')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transaction: data });
}
