import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';
const VALID_TYPES = new Set(['credit', 'debit', 'cash', 'savings', 'checking', 'other']);
const VALID_CATS = new Set(['personal', 'business']);

export async function GET() {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!VALID_TYPES.has(body.type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      user_id: USER_ID,
      name: body.name.trim(),
      short_name: body.short_name?.trim() || null,
      last_4: body.last_4?.trim() || null,
      type: body.type,
      category: VALID_CATS.has(body.category) ? body.category : 'personal',
      notes: body.notes?.trim() || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}
