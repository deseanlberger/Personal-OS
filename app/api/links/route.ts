import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { saveLink, extractUrl } from '@/lib/links/save';

const USER_ID = process.env.USER_ID || 'desean';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const q = (searchParams.get('q') || '').trim();
  const days = Math.min(Number(searchParams.get('days') || 365), 3650);
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabase
    .from('saved_links')
    .select('*')
    .eq('user_id', USER_ID)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);

  if (category) query = query.eq('category', category);
  if (q) {
    query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,description.ilike.%${q}%,url.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data || [], count: data?.length || 0 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  const url = extractUrl(rawUrl) || rawUrl;
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'valid url required' }, { status: 400 });
  }
  const link = await saveLink(url);
  if (!link) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  return NextResponse.json({ link });
}
