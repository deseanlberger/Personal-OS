import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

export async function GET() {
  const { data, error } = await supabase
    .from('category_budgets')
    .select('*')
    .eq('user_id', USER_ID)
    .order('category', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budgets: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.category || typeof body.monthly_amount !== 'number' || body.monthly_amount < 0) {
    return NextResponse.json({ error: 'category + monthly_amount (>= 0) required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('category_budgets')
    .upsert(
      {
        user_id: USER_ID,
        category: body.category,
        monthly_amount: body.monthly_amount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,category' },
    )
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budget: data });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  if (!category) return NextResponse.json({ error: 'category required' }, { status: 400 });
  const { error } = await supabase
    .from('category_budgets')
    .delete()
    .eq('user_id', USER_ID)
    .eq('category', category);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
