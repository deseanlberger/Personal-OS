import { NextRequest, NextResponse } from 'next/server';
import { redistributeMacros } from '@/lib/nutrition/estimator';

/** POST /api/nutrition/redistribute { name, kcal } → fresh macros at new calorie target */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.name || typeof body.kcal !== 'number') {
    return NextResponse.json({ error: 'name + kcal required' }, { status: 400 });
  }
  const macro = await redistributeMacros(String(body.name), Math.round(body.kcal));
  if (!macro) return NextResponse.json({ error: 'redistribute failed' }, { status: 500 });
  return NextResponse.json({ macro });
}
