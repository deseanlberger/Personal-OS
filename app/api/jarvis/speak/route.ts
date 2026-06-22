import { NextRequest, NextResponse } from 'next/server';
import { openaiClient, openaiAvailable } from '@/lib/llm/openai';

/**
 * POST /api/jarvis/speak  { text: string, voice?: 'onyx'|'echo'|'alloy'|'nova'|'fable'|'shimmer' }
 *
 * Returns an MP3 stream of the text spoken in the requested OpenAI TTS voice.
 * Default voice: onyx (closest match to the Iron Man Jarvis vibe).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }
  if (!openaiAvailable()) {
    return NextResponse.json({ error: 'OpenAI not configured' }, { status: 500 });
  }
  const text = body.text.slice(0, 4000); // OpenAI TTS max input
  const voice = (body.voice || 'onyx') as 'onyx' | 'echo' | 'alloy' | 'nova' | 'fable' | 'shimmer';

  try {
    const response = await openaiClient().audio.speech.create({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
    });
    const ab = await response.arrayBuffer();
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
