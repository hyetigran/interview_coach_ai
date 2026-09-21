import {test, expect, type APIRequestContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {registerInvited} from './register-invited';
import {testOrigin as origin, invitationFlags} from './test-target';
import type {MediaState, UploadState} from '../lib/media/contracts';

test('concurrent upload reservations respect the account allowance and reuse retries', async ({context, playwright}) => {
  test.setTimeout(180000);
  const candidate = context.request;
  const other = await playwright.request.newContext({baseURL: origin});
  const reviews: {client: APIRequestContext; endpoint: string}[] = [];
  async function register(client: APIRequestContext) {
    const email = `admission-${randomUUID()}@example.com`;
    const invitation = execFileSync('node', ['scripts/invite.mjs', email, ...invitationFlags], {encoding: 'utf8'}).trim().split('\n').at(-1)!;
    const response = await registerInvited(client, {headers: {origin, 'x-invitation-token': invitation}, data: {name: 'Admission Test', email, password: randomUUID() + randomUUID()}});
    expect(response.ok()).toBeTruthy();
  }
  async function create(client: APIRequestContext) {
    const response = await client.post('/api/reviews', {headers: {origin}, data: {title: 'Concurrent reservation test', role: 'Engineer', origin: 'mock'}});
    expect(response.ok()).toBeTruthy();
    const endpoint = '/api/reviews/' + (await response.json()).id;
    reviews.push({client, endpoint});
    return endpoint;
  }
  async function status(endpoint: string, client = candidate): Promise<MediaState> {
    const response = await client.get(endpoint + '/media');
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const input = () => ({actionId: randomUUID(), name: 'reservation-only.wav', size: 32044});
  try {
    await register(candidate);
    await register(other);
    const endpoints: string[] = [];
    for (let index = 0; index < 4; index++) endpoints.push(await create(candidate));
    const inputs = endpoints.map(input);
    expect(await status(endpoints[0])).toMatchObject({allowance: 3, admitted: 0, reserved: 0});

    // Only initiate multipart sessions. No bytes or completion requests are
    // sent, so this race cannot dispatch media processing or paid providers.
    const responses = await Promise.all(endpoints.map((endpoint, index) => candidate.post(endpoint + '/media', {headers: {origin}, data: inputs[index]})));
    expect(responses.map(response => response.status()).sort()).toEqual([200, 200, 200, 409]);
    const accepted = responses.flatMap((response, index) => response.status() === 200 ? [index] : []);
    const rejected = responses.findIndex(response => response.status() === 409);
    const uploads: UploadState[] = await Promise.all(accepted.map(index => responses[index].json()));
    expect(new Set(uploads.map(upload => upload.id)).size).toBe(3);
    for (const endpoint of endpoints) expect(await status(endpoint)).toMatchObject({admitted: 0, reserved: 3});

    const retryIndex = accepted[0];
    const retries = await Promise.all([1, 2, 3].map(() => candidate.post(endpoints[retryIndex] + '/media', {headers: {origin}, data: inputs[retryIndex]})));
    for (const response of retries) {
      expect(response.status()).toBe(200);
      expect((await response.json()).id).toBe(uploads[0].id);
    }
    expect(await status(endpoints[retryIndex])).toMatchObject({admitted: 0, reserved: 3});

    expect((await other.get(endpoints[retryIndex] + '/media')).status()).toBe(404);
    expect((await other.post(endpoints[retryIndex] + '/media', {headers: {origin}, data: input()})).status()).toBe(404);
    const otherEndpoint = await create(other);
    expect((await other.post(otherEndpoint + '/media', {headers: {origin}, data: input()})).status()).toBe(200);
    expect(await status(otherEndpoint, other)).toMatchObject({admitted: 0, reserved: 1});

    const removed = await candidate.delete(endpoints[retryIndex], {headers: {origin}, data: {}});
    expect([202, 204]).toContain(removed.status());
    expect((await candidate.get(endpoints[retryIndex] + '/media')).status()).toBe(404);
    expect(await status(endpoints[rejected])).toMatchObject({admitted: 0, reserved: 2});
    expect((await candidate.post(endpoints[rejected] + '/media', {headers: {origin}, data: inputs[rejected]})).status()).toBe(200);
    expect(await status(endpoints[rejected])).toMatchObject({admitted: 0, reserved: 3});
    // This releases an unadmitted reservation; it does not establish that
    // deleting an admitted recording replenishes the permanent allowance.
  } finally {
    try {
      const cleanup = await Promise.allSettled(reviews.map(async ({client, endpoint}) => {
        const response = await client.delete(endpoint, {headers: {origin}, data: {}});
        expect([202, 204]).toContain(response.status());
        await expect.poll(async () => {
          const deletion = await client.get(endpoint + '/deletion');
          expect(deletion.ok()).toBeTruthy();
          return (await deletion.json()).cleanupPending;
        }, {timeout: 60000}).toBe(false);
      }));
      expect(cleanup.filter(result => result.status === 'rejected')).toEqual([]);
    } finally { await other.dispose(); }
  }
});
