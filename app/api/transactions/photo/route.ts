import { NextRequest, NextResponse } from 'next/server';
import { parseReceiptFromImage } from '@/lib/finance/receiptParser';
import { driveConfigured, uploadReceipt } from '@/lib/google/drive';

/**
 * POST /api/transactions/photo  { image_base64, mime? }
 *
 * Returns the parsed receipt fields — caller decides whether to actually save it.
 * Use POST /api/transactions to persist after the user confirms account assignment.
 *
 * If Google Drive is configured (see lib/google/drive.ts), the raw image is
 * also uploaded to the tax folder in parallel. The Drive file_id + URL get
 * returned in the response so the client can pin them onto the eventual
 * transaction row.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.image_base64) return NextResponse.json({ error: 'image_base64 required' }, { status: 400 });
  const mime = typeof body.mime === 'string' ? body.mime : 'image/jpeg';
  const dataUri = body.image_base64.startsWith('data:')
    ? body.image_base64
    : `data:${mime};base64,${body.image_base64}`;

  // Run parse + drive upload in parallel — they don't depend on each other
  const drivePromise: Promise<{ file_id: string; web_view_link: string } | null> = (async () => {
    if (!driveConfigured()) return null;
    try {
      const bytes = Buffer.from(body.image_base64.replace(/^data:[^,]+,/, ''), 'base64');
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const filename = `receipt_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      return await uploadReceipt(bytes, mime, filename);
    } catch (err) {
      console.error('[transactions/photo] drive upload failed:', (err as Error).message);
      return null;
    }
  })();

  const [parsed, drive] = await Promise.all([parseReceiptFromImage(dataUri), drivePromise]);
  if (!parsed) return NextResponse.json({ error: 'parse failed' }, { status: 500 });
  return NextResponse.json({
    parsed,
    receipt_drive_file_id: drive?.file_id ?? null,
    receipt_drive_url: drive?.web_view_link ?? null,
  });
}
