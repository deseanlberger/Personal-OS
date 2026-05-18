import { NextResponse } from 'next/server';
import { flipWeekLabel } from '@/lib/app_meta';

export async function POST() {
  const newLabel = await flipWeekLabel();
  return NextResponse.json({ ok: true, weekLabel: newLabel });
}
