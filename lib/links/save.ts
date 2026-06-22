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

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(?:embed|shorts|v|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** YouTube has an oEmbed endpoint that returns title + author + thumbnail without an API key. */
async function fetchYouTubeOEmbed(url: string): Promise<{ title: string | null; author: string | null; thumbnail: string | null }> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return { title: null, author: null, thumbnail: null };
    const body = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return {
      title: body.title || null,
      author: body.author_name || null,
      thumbnail: body.thumbnail_url || null,
    };
  } catch {
    return { title: null, author: null, thumbnail: null };
  }
}

/** Pulls YouTube's auto-captioned transcript via the public timedtext endpoint. Returns empty string on failure. */
async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  // Try direct English captions first
  for (const lang of ['en', 'en-US', 'en-GB']) {
    try {
      const res = await fetch(
        `https://video.google.com/timedtext?lang=${lang}&v=${videoId}&fmt=json3`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) continue;
      const text = await res.text();
      if (!text) continue;
      try {
        const j = JSON.parse(text) as { events?: { segs?: { utf8?: string }[] }[] };
        if (!j.events) continue;
        const out: string[] = [];
        for (const e of j.events) {
          if (!e.segs) continue;
          for (const s of e.segs) {
            if (s.utf8) out.push(s.utf8);
          }
        }
        const joined = out.join(' ').replace(/\s+/g, ' ').trim();
        if (joined.length > 50) return joined.slice(0, 8000);
      } catch {
        // Not JSON — try next lang
      }
    } catch {
      // Network failed — try next lang
    }
  }
  return '';
}

export async function fetchUrlMetadata(url: string): Promise<Metadata & { transcript?: string }> {
  const domain = domainOf(url);
  const source_kind = inferKind(url);
  const meta: Metadata & { transcript?: string } = {
    title: null,
    description: null,
    thumbnail_url: null,
    domain,
    source_kind,
  };

  // YouTube short-circuit: oEmbed is reliable + we can grab the transcript
  if (source_kind === 'youtube') {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      const [oembed, transcript] = await Promise.all([
        fetchYouTubeOEmbed(url),
        fetchYouTubeTranscript(videoId),
      ]);
      meta.title = oembed.title;
      meta.thumbnail_url = oembed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      meta.description = oembed.author ? `by ${oembed.author}` : null;
      if (transcript) {
        meta.transcript = transcript;
        // Prefer the first ~280 chars of transcript over the author byline so the
        // /library card actually says what the video is about.
        meta.description = transcript.slice(0, 280).trim() + (transcript.length > 280 ? '…' : '');
      }
      return meta;
    }
  }

  try {
    const res = await fetch(url, {
      headers: {
        // Some sites give nothing to bot UAs — pretend to be a regular browser
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
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

async function classifyLink(meta: Metadata & { transcript?: string }, url: string): Promise<{
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
  const transcriptBlock = meta.transcript
    ? `\nTranscript (auto-captioned, first 4000 chars):\n${meta.transcript.slice(0, 4000)}\n`
    : '';
  const prompt = `Classify this link Desean saved.

URL: ${url}
Domain: ${meta.domain}
Source: ${meta.source_kind}
Title: ${meta.title || '(none)'}
Description: ${meta.description?.slice(0, 400) || '(none)'}${transcriptBlock}

Output JSON ONLY:
{
  "summary": "one-line plain-English summary of what this link actually teaches/contains, under 200 chars. Be concrete — say what the video/article is *about*, not just its title.",
  "category": "one of: training, programming, business, marketing, finance, athletes, recipes, tech, education, personal, other",
  "tags": ["kebab-case", "tags", "max 5"]
}

Categories favor Desean's life: he's a head coach (training/athletes), runs a coaching business, codes side projects, manages personal finances. Bias picks toward those when relevant.${
    transcriptBlock ? '\nWhen a transcript is provided, base the summary on the actual content, not just the title.' : ''
  }`;
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

  // Best-effort embedding for /brain search. Includes transcript when present
  // so /brain semantic search can match against video contents, not just titles.
  try {
    const blob = `${cls.summary}\n\n${meta.title || ''}\n${meta.description || ''}\n${cls.tags.join(' ')}\n${meta.transcript || ''}`.slice(0, 6000);
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
