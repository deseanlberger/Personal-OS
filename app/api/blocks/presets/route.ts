import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { invalidateCache } from '@/lib/blocks/templateStore';

const USER_ID = process.env.USER_ID || 'desean';

/** GET /api/blocks/presets — list all presets with block counts */
export async function GET() {
  const { data, error } = await supabase
    .from('template_presets')
    .select('id,name,description,is_active,created_at,updated_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const presets = data || [];

  // Add block counts per preset
  const { data: counts } = await supabase
    .from('block_templates')
    .select('preset_id')
    .eq('user_id', USER_ID)
    .eq('is_active', true);

  const countByPreset = new Map<string, number>();
  for (const row of counts || []) {
    const id = (row as { preset_id: string }).preset_id;
    countByPreset.set(id, (countByPreset.get(id) || 0) + 1);
  }

  return NextResponse.json({
    presets: presets.map((p) => ({ ...p, block_count: countByPreset.get(p.id) || 0 })),
  });
}

/** POST /api/blocks/presets — create empty preset */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const { data, error } = await supabase
    .from('template_presets')
    .insert({
      user_id: USER_ID,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      is_active: false,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateCache();
  return NextResponse.json({ preset: data });
}
