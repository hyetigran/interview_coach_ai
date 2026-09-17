export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body && typeof body === 'object' && ('error' in body || 'message' in body)
      ? ('error' in body ? body.error : 'message' in body ? body.message : null) : null;
    throw new RequestError(typeof message === 'string' ? message : 'Unable to complete the request. Please try again.', response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
