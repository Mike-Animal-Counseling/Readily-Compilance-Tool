import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { accessConfig, createSession, verifySession, safeRedirect, sessionCookie } from '../lib/auth/session';
import { guardApi } from '../lib/security/api';
import { createDataset, getDataset } from '../lib/data/dataset-store';
import { extractPdfPagesFromBuffer } from '../lib/pdf/extract-pages';
Object.assign(process.env, { NODE_ENV: 'test' });
delete process.env.REDIS_URL;
process.env.DEMO_ACCESS_CODE = randomBytes(32).toString('hex');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.APP_ORIGIN = 'http://localhost:3000';
test('configuration rejects missing, reused and weak credentials', () => {
  const secret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = ''; assert.throws(accessConfig);
  process.env.SESSION_SECRET = process.env.DEMO_ACCESS_CODE; assert.throws(accessConfig);
  process.env.SESSION_SECRET = secret;
});
test('sessions are signed, expire, and reject old access-code cookies', async () => {
  const token = await createSession();
  assert.ok(await verifySession(token));
  assert.equal(await verifySession(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')), null);
  assert.equal(await verifySession(process.env.DEMO_ACCESS_CODE), null);
  assert.equal(await verifySession(token.replace(/\.\d{10}\./, '.1000000000.')), null);
});
test('redirects cannot escape the application', () => {
  for (const input of ['//evil.test', '/\\evil.test', 'https://evil.test', '/\n/evil.test']) assert.equal(safeRedirect(input), '/');
  assert.equal(safeRedirect('/?ok=1'), '/?ok=1');
});
test('API guard enforces authentication, Origin and body limits', async () => {
  const handler = guardApi(async () => Response.json({ ok: true }), true);
  assert.equal((await handler(new Request('http://localhost:3000/api/test', { method: 'POST' }))).status, 401);
  const cookie = `${sessionCookie()}=${await createSession()}`;
  assert.equal((await handler(new Request('http://localhost:3000/api/test', { method: 'POST', headers: { cookie, origin: 'https://evil.test' } }))).status, 403);
  assert.equal((await handler(new Request('http://localhost:3000/api/test', { method: 'POST', headers: { cookie, origin: process.env.APP_ORIGIN! }, body: 'x'.repeat(65537) }))).status, 413);
  assert.equal((await handler(new Request('http://localhost:3000/api/test', { method: 'POST', headers: { cookie, origin: process.env.APP_ORIGIN! }, body: '{}' }))).status, 200);
});
test('uploaded datasets are scoped to each authenticated session', async () => {
  const id = await createDataset({ documents: [], chunks: [] }, 'owner-a');
  assert.ok(await getDataset(id, 'owner-a'));
  assert.equal(await getDataset(id, 'owner-b'), null);
});
test('invalid and oversized PDF uploads are rejected before parsing', async () => {
  await assert.rejects(extractPdfPagesFromBuffer(new TextEncoder().encode('<html>fake</html>')));
  await assert.rejects(extractPdfPagesFromBuffer(new Uint8Array(2 * 1024 * 1024 + 1)));
});
test('valid PDF text is extracted by the isolated worker', async () => {
  const stream = 'BT /F1 12 Tf 72 720 Td (Synthetic policy text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pages = await extractPdfPagesFromBuffer(Buffer.from(pdf));
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Synthetic policy text/);
});
