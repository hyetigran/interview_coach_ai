import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function invite(email: string) {
  const flags = process.env.E2E_PREVIEW_ORIGIN ? ['--remote', '--env', 'preview'] : [];
  return execFileSync('node', ['scripts/invite.mjs', email, ...flags], { encoding: 'utf8' }).trim().split('\n').at(-1)!;
}

test('invited candidate creates, reopens after sign-in, and deletes a review', async ({ page, playwright }) => {
  const email = `browser-${randomUUID()}@example.com`;
  const token = invite(email);
  const password = randomUUID() + randomUUID();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Have an invitation? Create account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Pilot Candidate');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Invitation code').fill(token);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your reviews' })).toBeVisible();
  await page.getByLabel('Review title').fill('Hiring manager discussion');
  await page.getByLabel('Target role').fill('Software engineer');
  await page.getByLabel('Interview type').selectOption('hiring');
  await page.getByRole('button', { name: 'Create review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hiring manager discussion' })).toBeVisible();
  await expect(page).toHaveURL(/\/reviews\/[a-f0-9-]{36}$/);
  const savedUrl = page.url();
  const origin = new URL(savedUrl).origin;
  const endpoint = origin + '/api' + new URL(savedUrl).pathname;
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await other.get(endpoint)).status()).toBe(401);
    const otherEmail = `browser-${randomUUID()}@example.com`;
    const registration = await other.post('/api/auth/sign-up/email', {
      headers: { origin, 'x-invitation-token': invite(otherEmail) },
      data: { name: 'Other Candidate', email: otherEmail, password: randomUUID() + randomUUID() },
    });
    expect(registration.ok()).toBeTruthy();
    expect((await other.get(endpoint)).status()).toBe(404);
    const deletion = await other.delete(endpoint, { headers: { origin }, data: {} });
    expect(deletion.status()).toBe(204);
    const list = await other.get('/api/reviews');
    expect((await list.json()).items).toEqual([]);
  } finally {
    await other.dispose();
  }
  const crossOrigin = await page.request.delete(endpoint, {
    headers: { origin: 'https://untrusted.example' }, data: {},
  });
  expect(crossOrigin.status()).toBe(403);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hiring manager discussion' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: /Hiring manager discussion/ }).click();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByRole('heading', { name: 'Hiring manager discussion' })).toBeVisible();
  const folder = mkdtempSync(join(tmpdir(), 'interview-coach-audio-'));
  try {
    const size = 5 * 1024 * 1024 + 44;
    const bytes = new Uint8Array(size); const header = new DataView(bytes.buffer);
    for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) bytes.set(new TextEncoder().encode(value), offset);
    header.setUint32(4, size - 8, true); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
    header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true); header.setUint32(40, size - 44, true);
    const audioPath = join(folder, 'synthetic.wav'); writeFileSync(audioPath, bytes);
    await page.route('**/parts/2', route => route.abort('failed'), { times: 1 });
    await page.getByLabel('Interview recording file', { exact: true }).setInputFiles(audioPath);
    await page.getByRole('button', { name: 'Upload recording', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /fetch|network/i })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Reselect the original file to resume/)).toBeVisible();
    await page.getByLabel('Interview recording file', { exact: true }).setInputFiles(audioPath);
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await expect(page.getByLabel('Private interview recording')).toBeVisible({ timeout: 30000 });
    await page.goto('/reviews');
    await page.goto(savedUrl);
    await expect(page.getByText('Recording prepared', { exact: true })).toBeVisible({ timeout: 30000 });
    const audio = await page.request.get(endpoint + '/audio', { headers: { range: 'bytes=0-43' } });
    expect(audio.status()).toBe(206);
    expect(audio.headers()['content-range']).toBe(`bytes 0-43/${size}`);
    expect((await audio.body()).byteLength).toBe(44);
    expect((await page.request.get(endpoint + '/audio', { headers: { range: 'bytes=999999999-' } })).status()).toBe(416);
  } finally { rmSync(folder, { recursive: true, force: true }); }
  const videoFolder = mkdtempSync(join(tmpdir(), 'interview-coach-video-'));
  try {
    const videoPath = join(videoFolder, 'interview.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', videoPath]);
    await page.goto('/reviews');
    await page.getByLabel('Review title').fill('Video interview');
    await page.getByLabel('Target role').fill('Engineer');
    await page.getByRole('button', { name: 'Create review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Video interview' })).toBeVisible();
    const videoUrl = page.url(); const videoEndpoint = origin + '/api' + new URL(videoUrl).pathname;
    await page.getByLabel('Interview recording file', { exact: true }).setInputFiles(videoPath);
    await page.getByRole('button', { name: 'Upload recording', exact: true }).click();
    await expect(page.getByText('interview.mp4', { exact: true })).toBeVisible();
    await page.goto('/reviews'); await page.goto(videoUrl);
    await expect(page.getByText('Recording prepared', { exact: true })).toBeVisible({ timeout: 30000 });
    const videoAudio = await page.request.get(videoEndpoint + '/audio', { headers: { range: 'bytes=0-43' } });
    expect(videoAudio.status()).toBe(206); expect(new TextDecoder().decode((await videoAudio.body()).subarray(8, 12))).toBe('WAVE');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Delete review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your reviews' })).toBeVisible();
    expect((await page.request.get(videoEndpoint + '/audio')).status()).toBe(404);
    await page.goto(savedUrl);
  } finally { rmSync(videoFolder, { recursive: true, force: true }); }
  await page.screenshot({ path: 'test-results/review-workspace.png', fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete review', exact: true }).click();
  await expect(page.getByText('No reviews yet. Create your first review to get started.')).toBeVisible();
  expect((await page.request.get(endpoint + '/audio')).status()).toBe(404);
  await page.goto(savedUrl);
  await expect(page.getByRole('alert').filter({ hasText: 'Review not found.' })).toBeVisible();
});
