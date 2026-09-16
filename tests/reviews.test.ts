import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { createReviewModule } from '../server/reviews';

const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'] }));
let reviews: ReturnType<typeof createReviewModule>;
beforeAll(async () => {
  const binding = await runtime.getD1Database('DB');
  const sql = readFileSync(new URL('../drizzle/0000_reviews.sql', import.meta.url), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await binding.prepare(statement.trim()).run();
  }
  reviews = createReviewModule(binding as unknown as D1Database);
});
afterAll(() => runtime.dispose());

test('a candidate can create and reopen their review', async () => {
  const created = await reviews.create('candidate-a', { title: 'Hiring manager interview', role: 'Software engineer', origin: 'hiring' });
  expect(await reviews.get('candidate-a', created.id)).toMatchObject({ title: 'Hiring manager interview', role: 'Software engineer', origin: 'hiring' });
  expect(await reviews.list('candidate-a')).toContainEqual(created);
});

test('another candidate cannot read or delete a private review', async () => {
  const created = await reviews.create('owner', { title: 'Private', role: 'Engineer', origin: 'mock' });
  expect(await reviews.get('stranger', created.id)).toBeNull();
  expect(await reviews.list('stranger')).toEqual([]);
  await reviews.remove('stranger', created.id);
  expect(await reviews.get('owner', created.id)).not.toBeNull();
  await reviews.remove('owner', created.id);
  expect(await reviews.get('owner', created.id)).toBeNull();
  expect(await reviews.list('owner')).toEqual([]);
  await reviews.remove('owner', created.id);
});
