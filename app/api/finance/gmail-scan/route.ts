import { NextRequest, NextResponse } from 'next/server';
import { runGmailScan } from '@/lib/finance/gmailScan';

/**
 * POST/GET /api/finance/gmail-scan
 *
 * Triggers the Gmail receipt scanner. Authed via the AUTH session
 * cookie (middleware) OR Authorization: Bearer ${CRON_SECRET}
 * (Vercel cron). Returns counts of scanned/found/inserted/duplicates.
 */
async function handle(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(Math.max(Number(searchParams.get('hours') || 1), 1), 720);

  // Cron auth (defense in depth — middleware already lets the bearer through)
  const bearer = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = bearer && cronSecret && bearer === `Bearer ${cronSecret}`;

  try {
    const result = await runGmailScan(hours);
    return NextResponse.json({ ok: true, isCron, hours, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
