import { supabase } from '@/lib/supabase/server';
import { blocksForWeek as blocksForWeekFromConstants, type BlockTemplate, type BlockType, type BlockEnergy, type WeekLabel } from './template';

const USER_ID = process.env.USER_ID || 'desean';
const CACHE_TTL_MS = 60_000;

type CacheEntry = { at: number; rows: DbBlock[] };
let _cache: CacheEntry | null = null;

export type DbBlock = {
  id: string;
  user_id: string;
  week_label: 'shared' | 'A' | 'B';
  day: number;
  start_time: string;
  end_time: string;
  name: string;
  type: BlockType;
  energy: BlockEnergy | null;
  locked: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function invalidateCache(): void {
  _cache = null;
}

export async function loadAllBlocks(): Promise<DbBlock[]> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.rows;

  // Find the active preset for this user.
  const { data: preset } = await supabase
    .from('template_presets')
    .select('id')
    .eq('user_id', USER_ID)
    .eq('is_active', true)
    .maybeSingle();

  let query = supabase
    .from('block_templates')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('is_active', true)
    .order('day', { ascending: true })
    .order('start_time', { ascending: true });

  // Filter by active preset if one exists. If presets table doesn't exist yet
  // (migration 0003 not run), the query above didn't filter and we get all rows.
  if (preset?.id) {
    query = query.eq('preset_id', preset.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[templateStore] load failed:', error.message);
    return [];
  }
  const rows = (data || []) as DbBlock[];
  _cache = { at: Date.now(), rows };
  return rows;
}

/** Convert DB row → BlockTemplate (the shape used by the recalc engine). */
function dbToTemplate(b: DbBlock): BlockTemplate {
  return {
    day: b.day,
    start: b.start_time,
    end: b.end_time,
    name: b.name,
    type: b.type,
    energy: b.energy || undefined,
    locked: b.locked,
  };
}

/**
 * Compose blocks for a given week from DB rows.
 *   - All 'shared' rows
 *   - Plus rows matching the requested label ('A' or 'B')
 * Falls back to the hardcoded template constants if the DB has no rows
 * (e.g. if migration 0002 hasn't been run yet) — keeps the system functional.
 */
export async function blocksForWeekFromDb(label: WeekLabel): Promise<BlockTemplate[]> {
  const all = await loadAllBlocks();
  if (all.length === 0) {
    console.warn('[templateStore] block_templates table empty — falling back to hardcoded template');
    return blocksForWeekFromConstants(label);
  }
  const filtered = all.filter((b) => b.week_label === 'shared' || b.week_label === label);
  return filtered
    .map(dbToTemplate)
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}
