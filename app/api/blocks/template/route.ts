import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { invalidateCache } from '@/lib/blocks/templateStore';

const USER_ID = process.env.USER_ID || 'desean';

const VALID_TYPES = new Set(['deep-thinking', 'deep-admin', 'multitask-admin', 'meeting', 'coaching', 'personal', 'flex']);
const VALID_ENERGIES = new Set(['high', 'med', 'low']);
const VALID_WEEK_LABELS = new Set(['shared', 'A', 'B']);

/**
 * GET /api/blocks/template?preset=<id>
 * Returns block templates for the requested preset, or the active preset if omitted.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let presetId = searchParams.get('preset');

  if (!presetId) {
    const { data: active } = await supabase
      .from('template_presets')
      .select('id')
      .eq('user_id', USER_ID)
      .eq('is_active', true)
      .maybeSingle();
    presetId = active?.id || null;
  }

  let query = supabase
    .from('block_templates')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('is_active', true)
    .order('day', { ascending: true })
    .order('start_time', { ascending: true });

  if (presetId) query = query.eq('preset_id', presetId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ blocks: data || [], preset_id: presetId });
}

/**
 * POST /api/blocks/template
 * Create a new block template.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const errors: string[] = [];
  if (typeof body.name !== 'string' || !body.name.trim()) errors.push('name required');
  if (typeof body.day !== 'number' || body.day < 0 || body.day > 6) errors.push('day must be 0-6');
  if (!/^\d{2}:\d{2}$/.test(body.start_time)) errors.push('start_time HH:MM required');
  if (!/^\d{2}:\d{2}$/.test(body.end_time)) errors.push('end_time HH:MM required');
  if (!VALID_TYPES.has(body.type)) errors.push('invalid type');
  if (body.energy && !VALID_ENERGIES.has(body.energy)) errors.push('invalid energy');
  if (body.week_label && !VALID_WEEK_LABELS.has(body.week_label)) errors.push('invalid week_label');
  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });

  // Default new blocks to the requested preset, or the active preset.
  let presetId = body.preset_id as string | undefined;
  if (!presetId) {
    const { data: active } = await supabase
      .from('template_presets')
      .select('id')
      .eq('user_id', USER_ID)
      .eq('is_active', true)
      .maybeSingle();
    presetId = active?.id;
  }

  const { data, error } = await supabase
    .from('block_templates')
    .insert({
      user_id: USER_ID,
      preset_id: presetId,
      week_label: body.week_label || 'shared',
      day: body.day,
      start_time: body.start_time,
      end_time: body.end_time,
      name: body.name.trim(),
      type: body.type,
      energy: body.energy || null,
      locked: !!body.locked,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateCache();
  return NextResponse.json({ block: data });
}
