import { takeBudget } from './store';
export async function providerFetch(url: string, options: RequestInit) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://openrouter.ai' || !['/api/v1/chat/completions', '/api/v1/embeddings'].includes(parsed.pathname)) throw new Error('Unsupported provider');
  const body = JSON.parse(String(options.body));
  if (parsed.pathname.endsWith('/chat/completions')) {
    body.max_tokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 1), 4096);
    if (!Array.isArray(body.messages) || body.messages.length > 20 || JSON.stringify(body.messages).length > 100000) throw new Error('Provider input limit exceeded');
  } else if (!Array.isArray(body.input) || body.input.length > 100 || JSON.stringify(body.input).length > 100000) throw new Error('Embedding input limit exceeded');
  if (!await takeBudget('provider-global', 100, 86400)) throw new Error('Daily provider budget exhausted');
  const timeout = AbortSignal.timeout(20000), signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { ...options, body: JSON.stringify(body), redirect: 'error', signal });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider request failed'); }
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.body?.getReader();
  if (reader) { try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Provider response limit exceeded'); } chunks.push(value); } } finally { reader.releaseLock(); } }
  return new Response(new Uint8Array(Buffer.concat(chunks)), { status: response.status, headers: response.headers });
}
