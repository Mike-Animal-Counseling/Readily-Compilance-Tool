import { accessConfig, requestSession } from '../auth/session';
import { takeBudget } from './store';
export async function boundedBody(request: Request, maxBytes: number) {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
  if (reader) {
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) { await reader.cancel(); throw new Error('Body too large'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function guardApi(handler: (request: Request) => Promise<Response>, write = false) {
  return async (request: Request) => {
    try {
      const config = accessConfig(), session = await requestSession(request);
      if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 });
      if (write && request.headers.get('origin') !== config.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403 });
      if (!await takeBudget(`api:${session.sid}`, write ? 20 : 180, 60) || !await takeBudget('api:global', 3000, 60) || (write && !await takeBudget('work:global', 200, 86400))) return Response.json({ error: 'Request limit reached' }, { status: 429 });
      const max = request.headers.get('content-type')?.startsWith('multipart/form-data') ? 7 * 1024 * 1024 : 64 * 1024;
      let nextRequest = request;
      if (write) {
        const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
        if (reader) { try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); return Response.json({ error: 'Request too large' }, { status: 413 }); } chunks.push(value); } } finally { reader.releaseLock(); } }
        nextRequest = new Request(request.url, { method: request.method, headers: request.headers, body: new Uint8Array(Buffer.concat(chunks)) });
      }
      const response = await handler(nextRequest); response.headers.set('Cache-Control', 'no-store'); return response;
    } catch { return Response.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  };
}
