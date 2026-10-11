import { NextResponse, type NextRequest } from 'next/server';
import { accessConfig, requestSession, safeRedirect } from './lib/auth/session';
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  const secure = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', csp); response.headers.set('X-Content-Type-Options', 'nosniff'); response.headers.set('Referrer-Policy', 'no-referrer'); response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return response;
  };
  try {
    const config = accessConfig();
    if (request.headers.get('host') !== new URL(config.origin).host) return secure(NextResponse.json({ error: 'Host not allowed' }, { status: 400 }));
    const path = request.nextUrl.pathname;
    const publicPath = path.startsWith('/_next/') || path === '/favicon.ico' || path === '/demo-access' || path === '/api/demo-access';
    if (!publicPath && !await requestSession(request)) {
      if (path.startsWith('/api/')) return secure(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));
      const login = new URL('/demo-access', config.origin); login.searchParams.set('redirectTo', safeRedirect(path + request.nextUrl.search));
      return secure(NextResponse.redirect(login));
    }
    const headers = new Headers(request.headers); headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp);
    return secure(NextResponse.next({ request: { headers } }));
  } catch { return secure(NextResponse.json({ error: 'Service configuration unavailable' }, { status: 503 })); }
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
