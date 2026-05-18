import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_MAX_AGE, signSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  const expected = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.AUTH_SECRET;

  if (!expected || !secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (typeof password !== 'string' || password !== expected) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const userId = process.env.USER_ID || 'desean';
  const token = await signSession(userId, secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
