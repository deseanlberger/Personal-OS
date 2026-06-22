import { NextResponse } from 'next/server';
import { jarvisTTS } from '@/lib/llm/jarvisVoice';

// Internal helper — reuses the brief endpoint's logic by importing the GET fn.
// Keeping them as separate files would require duplicating the data-gathering;
// instead we fetch the text from the brief endpoint by calling it server-side.
async function fetchBriefText(req: Request): Promise<string> {
  const briefUrl = new URL('/api/jarvis/brief', req.url).toString();
  const res = await fetch(briefUrl, {
    headers: {
      // Forward cookies so the brief endpoint sees the same session
      cookie: req.headers.get('cookie') || '',
      // Or use the cron secret bypass if available
      authorization: req.headers.get('authorization') || '',
      'x-api-secret': req.headers.get('x-api-secret') || '',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`brief upstream ${res.status}`);
  const body = (await res.json()) as { text?: string };
  return body.text || 'Briefing unavailable, sir.';
}

/**
 * GET /api/jarvis/brief-audio
 * Combines brief generation + TTS into a single response. The audio is the
 * MP3 body; the text is exposed via the X-Brief-Text header so the client
 * can render it. Built for iOS Safari which requires audio.play() to fire
 * inside one short async chain after a user gesture — keeping this to one
 * fetch lets the browser play immediately when the response arrives.
 */
export async function GET(req: Request) {
  let text: string;
  try {
    text = await fetchBriefText(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  try {
    const ab = await jarvisTTS(text);
    return new Response(ab, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        // Spoken text exposed so the client can display it alongside the audio
        'X-Brief-Text': encodeURIComponent(text),
        'Access-Control-Expose-Headers': 'X-Brief-Text',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
