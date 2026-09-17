import type { APIRequestContext } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';

// Synthetic candidates share one loopback IP. Respect the auth server's
// cooldown instead of disabling its protection or retrying arbitrary failures.
export async function registerInvited(request: APIRequestContext, options: NonNullable<Parameters<APIRequestContext['post']>[1]>) {
  const response = await request.post('/api/auth/sign-up/email', options);
  if (response.status() !== 429) return response;
  const seconds = Number(response.headers()['x-retry-after']);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10) return response;
  await response.dispose();
  await setTimeout(seconds * 1000 + 100);
  return request.post('/api/auth/sign-up/email', options);
}
