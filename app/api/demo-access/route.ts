import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { accessConfig, createSession, sessionCookie } from '../../../lib/auth/session';
import { boundedBody } from '../../../lib/security/api';
import { takeBudget } from '../../../lib/security/store';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const config = accessConfig();
    if (request.headers.get('origin') !== config.origin) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    if (!await takeBudget('access-global', 60, 3600)) return NextResponse.json({ error: 'Try again later' }, { status: 429 });
    const body = JSON.parse(await boundedBody(request, 2048));
    const code = typeof body?.code === 'string' && body.code.length <= 256 ? body.code : '';
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!code || !timingSafeEqual(digest(code), digest(config.code))) return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
    const response = NextResponse.json({ ok: true, enabled: true });
    response.cookies.set(sessionCookie(), await createSession(), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7200 });
    response.cookies.delete('readily_demo_access'); response.headers.set('Cache-Control', 'no-store'); return response;
  } catch { return NextResponse.json({ error: 'Unable to sign in' }, { status: 503 }); }
}
export async function DELETE(request: Request) {
  try {
    if (request.headers.get('origin') !== accessConfig().origin) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    const response = NextResponse.json({ ok: true }); response.cookies.set(sessionCookie(), '', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 }); return response;
  } catch { return NextResponse.json({ error: 'Unable to sign out' }, { status: 503 }); }
}
