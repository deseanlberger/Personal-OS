import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { invalidateCache } from '@/lib/blocks/templateStore';

const VALID_TYPES = new Set(['deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'coaching', 'personal', 'flex']);
const VALID_ENERGIES = new Set(['high', 'med', 'low']);
const VALID_WEEK_LABELS = new Set(['shared', 'A', 'B']);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.day === 'number' && body.day >= 0 && body.day <= 6) patch.day = body.day;
  if (typeof body.start_time === 'string' && /^\d{2}:\d{2}$/.test(body.start_time)) patch.start_time = body.start_time;
  if (typeof body.end_time === 'string' && /^\d{2}:\d{2}$/.test(body.end_time)) patch.end_time = body.end_time;
  if (typeof body.type === 'string' && VALID_TYPES.has(body.type)) patch.type = body.type;
  if (body.energy === null || (typeof body.energy === 'string' && VALID_ENERGIES.has(body.energy))) patch.energy = body.energy;
  if (typeof body.week_label === 'string' && VALID_WEEK_LABELS.has(body.week_label)) patch.week_label = body.week_label;
  if (typeof body.locked === 'boolean') patch.locked = body.locked;
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;

  const { data, error } = await supabase
    .from('block_templates')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateCache();
  return NextResponse.json({ block: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Soft delete: mark inactive instead of hard delete (preserves history)
  const { error } = await supabase
    .from('block_templates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateCache();
  return NextResponse.json({ ok: true });
}
