import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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
  await page.screenshot({ path: 'test-results/review-workspace.png', fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete review', exact: true }).click();
  await expect(page.getByText('No reviews yet. Create your first review to get started.')).toBeVisible();
  await page.goto(savedUrl);
  await expect(page.getByRole('alert').filter({ hasText: 'Review not found.' })).toBeVisible();
});
