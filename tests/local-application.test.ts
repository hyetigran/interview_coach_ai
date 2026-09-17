import { expect, test, vi } from 'vitest';
import { forwardLocalApplication, receiveLocalApplication } from '../server/local-application';

const env = { APP_ORIGIN: 'http://127.0.0.1:3000', LOCAL_API_ORIGIN: 'http://127.0.0.1:8789', AUTH_SECRET: 'isolated-local-proxy-secret' };

test('local API forwarding preserves authentication, origin, body and response without following redirects', async () => {
  const send = vi.fn<typeof fetch>(async (input, options) => {
    expect(input).toBeInstanceOf(Request);
    const forwarded = input as Request;
    expect(forwarded.url).toBe('http://127.0.0.1:8789/api/reviews?cursor=next');
    expect(options?.redirect).toBe('manual');
    expect(forwarded.headers.get('accept-encoding')).toBe('identity');
    const received = receiveLocalApplication(forwarded, env)!;
    expect(received.url).toBe('http://127.0.0.1:3000/api/reviews?cursor=next');
    expect(received.method).toBe('POST');
    expect(received.headers.get('cookie')).toBe('session=test');
    expect(received.headers.get('origin')).toBe(env.APP_ORIGIN);
    expect(received.headers.has('x-local-application-secret')).toBe(false);
    expect(await received.json()).toEqual({ title: 'Private review' });
    return new Response(null, { status: 302, headers: { location: '/reviews', 'set-cookie': 'session=updated; HttpOnly' } });
  });
  const response = await forwardLocalApplication(new Request(env.APP_ORIGIN + '/api/reviews?cursor=next', {
    method: 'POST', headers: { origin: env.APP_ORIGIN, cookie: 'session=test', 'content-type': 'application/json', 'x-local-application-secret': 'untrusted' }, body: JSON.stringify({ title: 'Private review' }),
  }), env, send);
  expect(response.status).toBe(302);
  expect(response.headers.get('set-cookie')).toBe('session=updated; HttpOnly');
});

test('the local hop rejects missing credentials, other origins and non-local configuration', () => {
  const request = () => new Request(env.LOCAL_API_ORIGIN + '/api/me', { headers: { 'x-local-application-secret': env.AUTH_SECRET } });
  expect(receiveLocalApplication(new Request(env.LOCAL_API_ORIGIN + '/api/me'), env)).toBeNull();
  expect(receiveLocalApplication(new Request(env.LOCAL_API_ORIGIN + '/api/me', { headers: { 'x-local-application-secret': 'wrong' } }), env)).toBeNull();
  expect(receiveLocalApplication(new Request('https://example.com/api/me', { headers: request().headers }), env)).toBeNull();
  for (const invalid of [{ ...env, AUTH_SECRET: '' }, { ...env, LOCAL_API_ORIGIN: undefined }, { ...env, APP_ORIGIN: 'https://preview.example.com' }, { ...env, LOCAL_API_ORIGIN: 'https://example.com' }]) {
    expect(receiveLocalApplication(request(), invalid)).toBeNull();
    expect(() => forwardLocalApplication(request(), invalid)).toThrow('Invalid local application configuration');
  }
});

test('untrusted browser origins are preserved for the application to reject', async () => {
  const send = vi.fn<typeof fetch>(async input => {
    expect(receiveLocalApplication(input as Request, env)?.headers.get('origin')).toBe('https://untrusted.example');
    return new Response(null, { status: 403 });
  });
  expect((await forwardLocalApplication(new Request(env.APP_ORIGIN + '/api/reviews', { method: 'POST', headers: { origin: 'https://untrusted.example' } }), env, send)).status).toBe(403);
});
