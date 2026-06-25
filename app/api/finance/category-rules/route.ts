import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * GET /api/finance/category-rules
 *
 * Lists vendor → category memorization rules. Used by the Settings tab to
 * show/edit/delete what the system has learned.
 */
export async function GET() {
  const { data, error } = await supabase
    .from('category_rules')
    .select('*')
    .eq('user_id', USER_ID)
    .order('hit_count', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data || [] });
}

/**
 * DELETE /api/finance/category-rules?vendor_normalized=...
 *
 * Forgets the rule for a vendor so the system goes back to default
 * categorization on the next import.
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const vendor = searchParams.get('vendor_normalized');
  if (!vendor) return NextResponse.json({ error: 'vendor_normalized required' }, { status: 400 });
  const { error } = await supabase
    .from('category_rules')
    .delete()
    .eq('user_id', USER_ID)
    .eq('vendor_normalized', vendor);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
