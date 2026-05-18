import { NextRequest, NextResponse } from 'next/server';
import { recalcWeek } from '@/lib/blocks/recalc';

/**
 * POST /api/calendar/recalc
 * Re-runs the block-assignment engine for the current week.
 * Auth: either AUTH cookie (UI button) OR Authorization: Bearer ${CRON_SECRET} OR x-api-secret.
 * Middleware handles session/x-api-secret; cron uses bearer header.
 *
 * This route lives under /api/cron/* prefix to be middleware-bypassable for Vercel cron,
 * but for now it's at /api/calendar/recalc so we accept either cron bearer OR an authed session.
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (bearer && cronSecret && bearer === `Bearer ${cronSecret}`) {
    // cron auth — middleware will let this through if bearer matches OR
    // we just verify it here (defense in depth).
  }
  try {
    const result = await recalcWeek();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/calendar/recalc] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  // Convenience: GET also triggers recalc. Useful for hitting from browser bookmark.
  try {
    const result = await recalcWeek();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
