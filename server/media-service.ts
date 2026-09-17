export type MediaServiceEnvironment = {
  MEDIA_PROCESSOR?: DurableObjectNamespace;
  LOCAL_MEDIA_ADAPTER?: string;
  AUTH_SECRET?: string;
};

export function mediaServiceRequest(env: MediaServiceEnvironment, path: string, init: RequestInit, request: typeof fetch = fetch) {
  if (env.MEDIA_PROCESSOR) {
    const stub = env.MEDIA_PROCESSOR.get(env.MEDIA_PROCESSOR.idFromName(path));
    return stub.fetch(new Request(`https://media.internal${path}`, init));
  }
  if (env.LOCAL_MEDIA_ADAPTER !== 'http://127.0.0.1:8790' || !env.AUTH_SECRET) throw new Error('Media processing is not configured.');
  return request(`${env.LOCAL_MEDIA_ADAPTER}${path}`, {...init, headers: {...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${env.AUTH_SECRET}`}});
}
