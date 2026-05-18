import { NextRequest, NextResponse } from 'next/server';
import { routeCapture, type CaptureSource } from '@/lib/router/routeCapture';

const ALLOWED_SOURCES: CaptureSource[] = ['web', 'ios_shortcut', 'api', 'telegram'];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }

  const sourceRaw = typeof body.source === 'string' ? body.source : 'web';
  const source: CaptureSource = ALLOWED_SOURCES.includes(sourceRaw as CaptureSource)
    ? (sourceRaw as CaptureSource)
    : 'web';

  try {
    const result = await routeCapture({
      text: body.text.trim(),
      source,
      audio_url: typeof body.audio_url === 'string' ? body.audio_url : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/capture] failed:', err);
    return NextResponse.json(
      { error: 'capture failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
