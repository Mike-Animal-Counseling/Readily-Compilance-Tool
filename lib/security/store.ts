import { createHash } from 'node:crypto';
import { createClient } from 'redis';
let client: ReturnType<typeof createClient> | undefined;
let connecting: Promise<void> | undefined;
const memory = new Map<string, { value: string; until: number }>();
export async function sharedClient() {
  if (!process.env.REDIS_URL) {
    if (process.env.NODE_ENV === 'production') throw new Error('Shared storage unavailable');
    return null;
  }
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true, commandsQueueMaxLength: 500, commandOptions: { timeout: 5000 }, socket: { connectTimeout: 5000, reconnectStrategy: retries => retries > 2 ? new Error('Storage unavailable') : 100 } });
    client.on('error', () => {});
    connecting = client.connect().then(() => {}).catch(() => { client = undefined; connecting = undefined; throw new Error('Storage unavailable'); });
  }
  await connecting;
  if (!client?.isReady) throw new Error('Shared storage unavailable');
  return client;
}
function prune() { const now = Date.now(); for (const [key, entry] of memory) if (entry.until <= now) memory.delete(key); }
export async function storeValue(key: string, value: unknown, seconds: number) {
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > 5 * 1024 * 1024) throw new Error('Record exceeds storage limit');
  const redis = await sharedClient();
  if (redis) { await redis.set('readily:data:' + key, data, { EX: seconds }); return; }
  prune(); if (!memory.has(key) && memory.size >= 200) throw new Error('Storage capacity exceeded');
  memory.set(key, { value: data, until: Date.now() + seconds * 1000 });
}
export async function loadValue<T>(key: string): Promise<T | null> {
  const redis = await sharedClient(); prune();
  const data = redis ? await redis.get('readily:data:' + key) : memory.get(key)?.value;
  return data ? JSON.parse(data) as T : null;
}
export async function takeBudget(key: string, limit: number, seconds: number) {
  const id = 'budget:' + createHash('sha256').update(key).digest('hex'), redis = await sharedClient();
  if (redis) {
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n";
    return Number(await redis.eval(script, { keys: ['readily:' + id], arguments: [String(seconds)] })) <= limit;
  }
  prune(); if (!memory.has(id) && memory.size >= 200) return false;
  const entry = memory.get(id) || { value: '0', until: Date.now() + seconds * 1000 };
  entry.value = String(Number(entry.value) + 1); memory.set(id, entry);
  return Number(entry.value) <= limit;
}
