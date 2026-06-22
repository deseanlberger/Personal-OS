import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy init: don't throw at module load. Next.js' "Collecting page data" build
// step imports every route's modules, and if this file throws when env vars
// are missing (e.g. on Vercel Preview with no secrets), the entire build
// crashes. The Proxy below defers createClient() until first property access
// at runtime, where missing env is still surfaced as a clear error.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
