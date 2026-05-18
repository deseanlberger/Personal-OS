import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { invalidateCache } from '@/lib/blocks/templateStore';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * POST /api/blocks/presets/[id]/activate
 * Atomically switch which preset is active. There's a unique partial index on
 * (user_id) where is_active=true, so we must clear before setting.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // First clear the currently-active preset
  await supabase
    .from('template_presets')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', USER_ID)
    .eq('is_active', true);

  // Then set the new one active
  const { data, error } = await supabase
    .from('template_presets')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', USER_ID)
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'preset not found' }, { status: 500 });
  }
  invalidateCache();
  return NextResponse.json({ preset: data });
}
