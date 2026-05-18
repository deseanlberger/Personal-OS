import { NextRequest, NextResponse } from 'next/server';
import { estimateMacrosFromText, estimateMacrosFromImage } from '@/lib/nutrition/estimator';

/**
 * POST /api/nutrition/estimate
 *   { text: string }                                  — text → macros (Claude)
 *   { image_base64: string, mime?: string }           — photo → macros (GPT-4o vision)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  // Image path
  if (typeof body.image_base64 === 'string' && body.image_base64.length > 0) {
    const mime = typeof body.mime === 'string' ? body.mime : 'image/jpeg';
    const dataUri = body.image_base64.startsWith('data:')
      ? body.image_base64
      : `data:${mime};base64,${body.image_base64}`;
    const macro = await estimateMacrosFromImage(dataUri);
    if (!macro) return NextResponse.json({ error: 'image estimation failed' }, { status: 500 });
    return NextResponse.json({ macro });
  }

  // Text path
  if (typeof body.text === 'string' && body.text.trim().length > 0) {
    const macro = await estimateMacrosFromText(body.text.trim());
    if (!macro) return NextResponse.json({ error: 'estimation failed' }, { status: 500 });
    return NextResponse.json({ macro });
  }

  return NextResponse.json({ error: 'text or image_base64 required' }, { status: 400 });
}
