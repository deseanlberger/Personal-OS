import { supabase } from '@/lib/supabase/server';

/** Read a value from app_meta key/value table. */
export async function getMeta(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_meta')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.error('[app_meta.get]', key, error.message);
    return null;
  }
  return data?.value ?? null;
}

/** Write a value to app_meta (upsert). */
export async function setMeta(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('app_meta')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    console.error('[app_meta.set]', key, error.message);
  }
}

export async function getWeekLabel(): Promise<'A' | 'B'> {
  const v = await getMeta('cc_week_label');
  return v === 'B' ? 'B' : 'A';
}

export async function flipWeekLabel(): Promise<'A' | 'B'> {
  const cur = await getWeekLabel();
  const next: 'A' | 'B' = cur === 'A' ? 'B' : 'A';
  await setMeta('cc_week_label', next);
  return next;
}
