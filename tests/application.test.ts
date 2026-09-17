import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createApplication } from '../server/application';

const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
const origin = 'http://localhost:3000';
const inviteToken = 'test-invitation-token-with-at-least-32-characters';
let app: ReturnType<typeof createApplication>;
beforeAll(async () => {
  const binding = await runtime.getD1Database('DB');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await binding.prepare(statement.trim()).run();
    }
  }
  await binding.prepare('INSERT INTO invitations (email, token_hash, expires_at) VALUES (?, ?, ?)').bind('candidate@example.com', createHash('sha256').update(inviteToken).digest('hex'), Date.now() + 3600000).run();
  app = createApplication({ DB: binding as unknown as D1Database, MEDIA: await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket, APP_ORIGIN: origin, AUTH_SECRET: 'test-secret-used-only-in-isolated-tests-123456789' });
});
afterAll(() => runtime.dispose());
let clientNumber = 0;
const send = (path: string, body: unknown, extra: Record<string, string> = {}) => app.fetch(new Request(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': `192.0.2.${++clientNumber}`, ...extra }, body: JSON.stringify(body) }));

test('only an invited candidate can register, sign in, and reopen a private review', async () => {
  const credentials = { email: 'candidate@example.com', password: 'strong-test-password-123', name: 'Candidate' };
  expect((await send('/api/auth/sign-up/email', credentials)).status).toBe(403);
  const registration = await send('/api/auth/sign-up/email', credentials, { 'x-invitation-token': inviteToken });
  expect(registration.status, await registration.clone().text()).toBe(200);
  const login = await send('/api/auth/sign-in/email', credentials);
  expect(login.status, await login.clone().text()).toBe(200);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  expect(cookie).toContain('session_token=');
  const created = await send('/api/reviews', { title: 'Architecture discussion', role: 'Senior engineer', origin: 'hiring' }, { cookie });
  expect(created.status, await created.clone().text()).toBe(201);
  const review = await created.json() as { id: string };
  const reopened = await app.fetch(new Request(`${origin}/api/reviews/${review.id}`, { headers: { cookie } }));
  expect(await reopened.json()).toMatchObject({ title: 'Architecture discussion', role: 'Senior engineer' });
});

test('HTTP requests enforce owner isolation, input validation, and same-origin mutations', async () => {
  const secondEmail = 'second@example.com';
  const binding = await runtime.getD1Database('DB');
  const secondToken = 'second-invitation-token-with-at-least-32-characters';
  await binding.prepare('INSERT INTO invitations (email, token_hash, expires_at) VALUES (?, ?, ?)').bind(secondEmail, createHash('sha256').update(secondToken).digest('hex'), Date.now() + 3600000).run();
  const credentials = { email: secondEmail, name: 'Second', password: 'different-strong-password-123' };
  await send('/api/auth/sign-up/email', credentials, { 'x-invitation-token': secondToken });
  const login = await send('/api/auth/sign-in/email', credentials);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  expect((await send('/api/auth/sign-up/email', credentials, { 'x-invitation-token': secondToken })).status).toBe(403);
  expect((await send('/api/auth/sign-up/email', { ...credentials, email: 'outsider@example.com' }, { 'x-invitation-token': secondToken })).status).toBe(403);
  expect((await app.fetch(new Request(origin + '/api/reviews'))).status).toBe(401);
  const payload = { title: 'Private review', role: 'Engineer', origin: 'mock' };
  expect((await send('/api/reviews', payload, { cookie, origin: 'https://untrusted.example' })).status).toBe(403);
  expect((await send('/api/reviews', { ...payload, role: ' ' }, { cookie })).status).toBe(400);
  expect((await send('/api/reviews', { ...payload, ownerId: 'injected' }, { cookie })).status).toBe(400);
  const created = await send('/api/reviews', payload, { cookie });
  const review = await created.json() as { id: string };
  const otherLogin = await send('/api/auth/sign-in/email', { email: 'candidate@example.com', password: 'strong-test-password-123' });
  const otherCookie = otherLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  expect((await app.fetch(new Request(`${origin}/api/reviews/${review.id}`, { headers: { cookie: otherCookie } }))).status).toBe(404);
  await app.fetch(new Request(`${origin}/api/reviews/${review.id}`, { method: 'DELETE', headers: { cookie: otherCookie, origin, 'content-type': 'application/json' } }));
  expect((await app.fetch(new Request(`${origin}/api/reviews/${review.id}`, { headers: { cookie } }))).status).toBe(200);
  const deleted = await app.fetch(new Request(`${origin}/api/reviews/${review.id}`, { method: 'DELETE', headers: { cookie, origin, 'content-type': 'application/json' } }));
  expect(deleted.status).toBe(204);
  expect((await app.fetch(new Request(`${origin}/api/reviews/${review.id}`, { headers: { cookie } }))).status).toBe(404);
});

test('revoking an invitation blocks existing sessions and new sign-ins', async () => {
  const login = await send('/api/auth/sign-in/email', { email: 'candidate@example.com', password: 'strong-test-password-123' });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const binding = await runtime.getD1Database('DB');
  await binding.prepare('UPDATE invitations SET revoked = 1 WHERE email = ?').bind('candidate@example.com').run();
  expect((await app.fetch(new Request(origin + '/api/reviews', { headers: { cookie } }))).status).toBe(403);
  expect((await send('/api/auth/sign-in/email', { email: 'candidate@example.com', password: 'strong-test-password-123' })).status).toBe(403);
});
