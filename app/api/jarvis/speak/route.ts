import { NextRequest, NextResponse } from 'next/server';
import { jarvisTTS } from '@/lib/llm/jarvisVoice';

/**
 * POST /api/jarvis/speak  { text: string }
 *
 * Returns an MP3 of the text spoken in the J.A.R.V.I.S. British-butler voice
 * (gpt-4o-mini-tts with custom instructions).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }
  try {
    const ab = await jarvisTTS(body.text);
    return new Response(ab, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
