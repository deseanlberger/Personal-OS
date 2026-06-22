import { z } from 'zod';
import { supabase } from '@/lib/supabase/server';
import { claudeClient, claudeModel, claudeAvailable } from '@/lib/llm/claude';
import { embed } from '@/lib/embeddings';

const USER_ID = process.env.USER_ID || 'desean';

type LinkSource = 'youtube' | 'instagram' | 'twitter' | 'tiktok' | 'article' | 'other';

type Metadata = {
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  domain: string;
  source_kind: LinkSource;
};

const ClassifySchema = z.object({
  summary: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  tags: z.array(z.string()).max(6),
});

function safeJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

function inferKind(url: string): LinkSource {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('tiktok.com')) return 'tiktok';
  return 'article';
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function parseMetaTag(html: string, name: string): string | null {
  // og:title, og:description, og:image, twitter:title, etc.
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  if (m && m[1]) return m[1].trim();
  // Try reversed order: content first, then name
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2 && m2[1] ? m2[1].trim() : null;
}

function decodeHtml(s: string | null): string | null {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function fetchUrlMetadata(url: string): Promise<Metadata> {
  const domain = domainOf(url);
  const source_kind = inferKind(url);
  const meta: Metadata = { title: null, description: null, thumbnail_url: null, domain, source_kind };
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PersonalOS-Bot/1.0; +https://personal-os-woad.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return meta;
    const html = await res.text();
    meta.title =
      decodeHtml(parseMetaTag(html, 'og:title')) ||
      decodeHtml(parseMetaTag(html, 'twitter:title')) ||
      decodeHtml(html.match(/<title>([^<]+)<\/title>/i)?.[1] || null);
    meta.description =
      decodeHtml(parseMetaTag(html, 'og:description')) ||
      decodeHtml(parseMetaTag(html, 'twitter:description')) ||
      decodeHtml(parseMetaTag(html, 'description'));
    meta.thumbnail_url =
      parseMetaTag(html, 'og:image') ||
      parseMetaTag(html, 'twitter:image');
  } catch (err) {
    console.error('[fetchUrlMetadata] failed for', url, (err as Error).message);
  }
  return meta;
}

async function classifyLink(meta: Metadata, url: string): Promise<{
  summary: string;
  category: string;
  tags: string[];
}> {
  const fallback = {
    summary: meta.title || url,
    category: 'uncategorized',
    tags: [meta.source_kind] as string[],
  };
  if (!claudeAvailable()) return fallback;
  const prompt = `Classify this link Desean saved.

URL: ${url}
Domain: ${meta.domain}
Source: ${meta.source_kind}
Title: ${meta.title || '(none)'}
Description: ${meta.description?.slice(0, 400) || '(none)'}

Output JSON ONLY:
{
  "summary": "one-line plain-English summary under 200 chars",
  "category": "one of: training, programming, business, marketing, finance, athletes, recipes, tech, education, personal, other",
  "tags": ["kebab-case", "tags", "max 5"]
}

Categories favor Desean's life: he's a head coach (training/athletes), runs a coaching business, codes side projects, manages personal finances. Bias picks toward those when relevant.`;
  try {
    const msg = await claudeClient().messages.create({
      model: claudeModel(),
      max_tokens: 400,
      system: 'You categorize saved links for a personal OS. Output JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    if (block?.type !== 'text') return fallback;
    const parsed = ClassifySchema.parse(safeJson(block.text));
    return parsed;
  } catch (err) {
    console.error('[classifyLink] failed:', (err as Error).message);
    return fallback;
  }
}

export type SavedLink = {
  id: string;
  url: string;
  title: string | null;
  summary: string | null;
  category: string | null;
  tags: string[];
  domain: string | null;
  thumbnail_url: string | null;
  source_kind: string;
  created_at: string;
};

export async function saveLink(url: string): Promise<SavedLink | null> {
  const meta = await fetchUrlMetadata(url);
  const cls = await classifyLink(meta, url);

  const { data, error } = await supabase
    .from('saved_links')
    .insert({
      user_id: USER_ID,
      url,
      domain: meta.domain || null,
      source_kind: meta.source_kind,
      title: meta.title,
      description: meta.description,
      thumbnail_url: meta.thumbnail_url,
      summary: cls.summary,
      category: cls.category,
      tags: cls.tags,
      raw_meta: { meta, classification: cls } as unknown as Record<string, unknown>,
    })
    .select('id, url, title, summary, category, tags, domain, thumbnail_url, source_kind, created_at')
    .single();
  if (error) {
    console.error('[saveLink] insert failed:', error.message);
    return null;
  }

  // Best-effort embedding for /brain search.
  try {
    const blob = `${cls.summary}\n\n${meta.title || ''}\n${meta.description || ''}\n${cls.tags.join(' ')}`.slice(0, 4000);
    const vec = await embed(blob);
    if (vec && data?.id) {
      await supabase.from('memory_chunks').insert({
        user_id: USER_ID,
        source_type: 'note',
        source_id: data.id,
        text: cls.summary,
        embedding: vec as unknown as string,
      });
    }
  } catch (err) {
    console.error('[saveLink] embed failed:', (err as Error).message);
  }

  return data as SavedLink;
}

const URL_RE = /https?:\/\/[^\s]+/i;
export function extractUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0].replace(/[),.;]+$/, '') : null;
}
