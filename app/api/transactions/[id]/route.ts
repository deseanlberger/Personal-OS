import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';

const USER_ID = process.env.USER_ID || 'desean';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ['account_id', 'txn_date', 'amount', 'vendor', 'category', 'memo', 'is_business', 'needs_review', 'subscription_status', 'subscription_confirmed']) {
    if (f in body) patch[f] = body[f];
  }
  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select('*, account:accounts(id,name,short_name,last_4,category,type)').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-learn: if user just set a category (or is_business) on a vendor,
  // upsert a category_rule so future imports of the same vendor pick up
  // the choice automatically. Fire-and-forget — failure here doesn't break
  // the user's edit.
  if ((('category' in body) || ('is_business' in body)) && data?.vendor) {
    const vendorNorm = String(data.vendor).trim().toLowerCase();
    if (vendorNorm) {
      const rulePatch: Record<string, unknown> = { user_id: USER_ID, vendor_normalized: vendorNorm, updated_at: new Date().toISOString() };
      if ('category' in body && body.category) rulePatch.category = body.category;
      if ('is_business' in body) rulePatch.is_business = !!body.is_business;
      try {
        // Insert-or-bump pattern: upsert with hit_count increment via raw SQL.
        const { data: existing } = await supabase
          .from('category_rules')
          .select('id, hit_count, category, is_business')
          .eq('user_id', USER_ID)
          .eq('vendor_normalized', vendorNorm)
          .maybeSingle();
        if (existing) {
          await supabase
            .from('category_rules')
            .update({
              category: ('category' in body && body.category) ? body.category : existing.category,
              is_business: ('is_business' in body) ? !!body.is_business : existing.is_business,
              hit_count: existing.hit_count + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        } else if ('category' in body && body.category) {
          // Only create a rule when we know the category (is_business alone isn't enough)
          await supabase.from('category_rules').insert({
            user_id: USER_ID,
            vendor_normalized: vendorNorm,
            category: body.category,
            is_business: 'is_business' in body ? !!body.is_business : null,
          });
        }
      } catch (err) {
        console.error('[transactions PATCH] category_rules upsert failed:', (err as Error).message);
      }
    }
  }

  return NextResponse.json({ transaction: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
