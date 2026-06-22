import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { localDateKey } from '@/lib/habits/date';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * POST /api/finance/mileage — iOS Shortcut "Log Trip Mileage" posts here.
 *
 * Body: {
 *   miles: number (required, positive)
 *   from?: string, to?: string, purpose?: string,
 *   is_business?: boolean (default false),
 *   trip_date?: 'YYYY-MM-DD' (defaults to today in user's TZ),
 * }
 *
 * Auth: middleware lets through if x-api-secret header matches API_SECRET,
 * or via session cookie.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 });
  const miles = Number(body.miles);
  if (!Number.isFinite(miles) || miles <= 0) {
    return NextResponse.json({ error: 'miles required (positive number)' }, { status: 400 });
  }
  const row = {
    user_id: USER_ID,
    trip_date: typeof body.trip_date === 'string' ? body.trip_date : localDateKey(),
    from_address: body.from ?? body.from_address ?? null,
    to_address: body.to ?? body.to_address ?? null,
    miles,
    is_business: body.is_business === true || body.is_business === 'true',
    purpose: body.purpose ?? null,
    source: body.source || 'shortcut',
  };
  const { data, error } = await supabase
    .from('mileage_logs')
    .insert(row)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, log: data });
}

/**
 * GET /api/finance/mileage?days=90 — list recent trips and totals.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') || 90), 1), 730);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('mileage_logs')
    .select('*')
    .eq('user_id', USER_ID)
    .gte('trip_date', since.toISOString().slice(0, 10))
    .order('trip_date', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const logs = data || [];
  const business_miles = logs.filter((l) => l.is_business).reduce((s, l) => s + Number(l.miles), 0);
  const personal_miles = logs.filter((l) => !l.is_business).reduce((s, l) => s + Number(l.miles), 0);
  return NextResponse.json({
    days,
    logs,
    totals: {
      business_miles,
      personal_miles,
      total_miles: business_miles + personal_miles,
      // 2026 IRS standard mileage rate for business use: $0.67/mi (uses prior-year
      // rate; user should verify on irs.gov each Jan).
      business_deduction_estimate: business_miles * 0.67,
    },
  });
}
