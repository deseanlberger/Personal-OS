import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { invalidateCache } from '@/lib/blocks/templateStore';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === 'string') patch.description = body.description.trim() || null;

  const { data, error } = await supabase
    .from('template_presets')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateCache();
  return NextResponse.json({ preset: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Don't allow deleting the active preset — would leave the system without a schedule.
  const { data: preset } = await supabase
    .from('template_presets')
    .select('is_active')
    .eq('id', id)
    .maybeSingle();
  if (preset?.is_active) {
    return NextResponse.json({ error: 'Cannot delete the active preset. Activate a different one first.' }, { status: 400 });
  }

  // Cascade deletes block_templates with this preset_id (per FK constraint).
  const { error } = await supabase.from('template_presets').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateCache();
  return NextResponse.json({ ok: true });
}
