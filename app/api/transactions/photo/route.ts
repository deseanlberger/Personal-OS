import { NextRequest, NextResponse } from 'next/server';
import { parseReceiptFromImage } from '@/lib/finance/receiptParser';

/**
 * POST /api/transactions/photo  { image_base64, mime? }
 * Returns the parsed receipt fields — caller decides whether to actually save it.
 * Use POST /api/transactions to persist after the user confirms account assignment.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.image_base64) return NextResponse.json({ error: 'image_base64 required' }, { status: 400 });
  const mime = typeof body.mime === 'string' ? body.mime : 'image/jpeg';
  const dataUri = body.image_base64.startsWith('data:')
    ? body.image_base64
    : `data:${mime};base64,${body.image_base64}`;
  const parsed = await parseReceiptFromImage(dataUri);
  if (!parsed) return NextResponse.json({ error: 'parse failed' }, { status: 500 });
  return NextResponse.json({ parsed });
}
