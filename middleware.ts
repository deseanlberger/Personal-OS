import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifySession } from './lib/auth';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth/',
  '/api/telegram/webhook',
  '/api/cron/',
  '/_next/',
  '/favicon',
  '/manifest',
  '/icon',
  '/apple-icon',
];

// Static asset extensions served from /public — never gated.
const PUBLIC_FILE_EXT = /\.(?:svg|png|jpe?g|webp|gif|ico|webmanifest|txt|xml|woff2?)$/i;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (PUBLIC_FILE_EXT.test(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    const apiSecret = req.headers.get('x-api-secret');
    if (apiSecret && process.env.API_SECRET && apiSecret === process.env.API_SECRET) {
      return NextResponse.next();
    }
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return new NextResponse('Server misconfigured: AUTH_SECRET unset', { status: 500 });
  }

  const userId = await verifySession(token, secret);
  if (!userId) {
    if (pathname.startsWith('/api/')) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
