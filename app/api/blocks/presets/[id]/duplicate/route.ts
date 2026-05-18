import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { invalidateCache } from '@/lib/blocks/templateStore';

const USER_ID = process.env.USER_ID || 'desean';

/**
 * POST /api/blocks/presets/[id]/duplicate  { name?: string }
 * Deep-clone: copies the preset + all its blocks under a new preset (inactive).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Load source preset
  const { data: source, error: srcErr } = await supabase
    .from('template_presets')
    .select('*')
    .eq('id', id)
    .eq('user_id', USER_ID)
    .maybeSingle();
  if (srcErr || !source) {
    return NextResponse.json({ error: srcErr?.message || 'source preset not found' }, { status: 404 });
  }

  // Create new preset (inactive)
  const newName = (body.name as string)?.trim() || `${source.name} (copy)`;
  const { data: newPreset, error: insErr } = await supabase
    .from('template_presets')
    .insert({
      user_id: USER_ID,
      name: newName,
      description: source.description,
      is_active: false,
    })
    .select('*')
    .single();
  if (insErr || !newPreset) {
    return NextResponse.json({ error: insErr?.message || 'create failed' }, { status: 500 });
  }

  // Load source blocks
  const { data: blocks, error: bErr } = await supabase
    .from('block_templates')
    .select('week_label,day,start_time,end_time,name,type,energy,locked,is_active')
    .eq('user_id', USER_ID)
    .eq('preset_id', id);
  if (bErr) {
    return NextResponse.json({ error: bErr.message }, { status: 500 });
  }

  // Insert clones under the new preset
  if (blocks && blocks.length > 0) {
    const clones = blocks.map((b) => ({ ...b, user_id: USER_ID, preset_id: newPreset.id }));
    const { error: cloneErr } = await supabase.from('block_templates').insert(clones);
    if (cloneErr) {
      return NextResponse.json({ error: cloneErr.message }, { status: 500 });
    }
  }

  invalidateCache();
  return NextResponse.json({ preset: newPreset, cloned_blocks: blocks?.length || 0 });
}
