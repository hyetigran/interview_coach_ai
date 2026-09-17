const localOrigin = 'http://127.0.0.1:3000';
const workerOrigin = 'http://127.0.0.1:8789';
const secretHeader = 'x-local-application-secret';
type LocalEnvironment = Pick<CloudflareEnv, 'APP_ORIGIN' | 'AUTH_SECRET' | 'LOCAL_API_ORIGIN'>;

function enabled(env: LocalEnvironment) {
  return env.APP_ORIGIN === localOrigin && env.LOCAL_API_ORIGIN === workerOrigin && Boolean(env.AUTH_SECRET);
}

// Only local development uses this hop. Keep API and Workflow D1 operations in
// the same workerd process rather than opening one SQLite database twice.
export function forwardLocalApplication(request: Request, env: LocalEnvironment, send: typeof fetch = fetch) {
  if (!enabled(env)) throw new Error('Invalid local application configuration.');
  const incoming = new URL(request.url);
  const forwarded = new Request(workerOrigin + incoming.pathname + incoming.search, request);
  forwarded.headers.delete('host');
  // Node fetch decodes compressed bodies but retains their encoding header.
  // Ask the local hop for identity bytes so Next can encode its own response.
  forwarded.headers.set('accept-encoding', 'identity');
  forwarded.headers.set(secretHeader, env.AUTH_SECRET);
  return send(forwarded, { redirect: 'manual' });
}

export function receiveLocalApplication(request: Request, env: LocalEnvironment): Request | null {
  const incoming = new URL(request.url);
  if (!enabled(env) || incoming.origin !== workerOrigin || request.headers.get(secretHeader) !== env.AUTH_SECRET) return null;
  const forwarded = new Request(localOrigin + incoming.pathname + incoming.search, request);
  forwarded.headers.delete(secretHeader);
  forwarded.headers.delete('host');
  return forwarded;
}
