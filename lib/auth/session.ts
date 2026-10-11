export type AccessSession = { sid: string; exp: number };
export function accessConfig() {
  const code = process.env.DEMO_ACCESS_CODE || '', secret = process.env.SESSION_SECRET || '';
  const origin = process.env.APP_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (code.length < 32 || secret.length < 32 || code === secret || /READILY2026|replace|change.?me|example/i.test(code + secret)) throw new Error('Configure independently generated access and session secrets');
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol)) throw new Error('Configure APP_ORIGIN');
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL?.startsWith('rediss://')) throw new Error('Configure TLS Redis');
  return { code, secret, origin };
}
export const sessionCookie = () => process.env.NODE_ENV === 'production' ? '__Host-readily_session' : 'readily_session';
const encoder = new TextEncoder();
async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function createSession() {
  const config = accessConfig(), value = `${crypto.randomUUID()}.${Math.floor(Date.now() / 1000) + 7200}`;
  return `${value}.${await sign(value, config.secret)}`;
}
export async function verifySession(token: string | undefined): Promise<AccessSession | null> {
  if (!token || token.length > 160) return null;
  const [sid, expText, signature, extra] = token.split('.');
  if (extra || !/^[a-f\d-]{36}$/i.test(sid) || !/^\d{10}$/.test(expText) || !/^[a-f\d]{64}$/i.test(signature || '')) return null;
  const exp = Number(expText), now = Math.floor(Date.now() / 1000);
  if (exp <= now || exp > now + 7200) return null;
  const expected = await sign(`${sid}.${expText}`, accessConfig().secret);
  let difference = 0; for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference ? null : { sid, exp };
}
export async function requestSession(request: Request) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(sessionCookie() + '='));
  return verifySession(cookie?.slice(sessionCookie().length + 1));
}
export function safeRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/';
  try { return new URL(value, accessConfig().origin).origin === accessConfig().origin ? value : '/'; } catch { return '/'; }
}
