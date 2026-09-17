import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createTranscriptionModule, transcriptionIntent } from '../server/transcription';
import { parseTranscript } from '../lib/transcript';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
let db: D1Database; let bucket: R2Bucket;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database; bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
});
afterAll(() => runtime.dispose());
const provider = { duration: 2, segments: [{ start: 0, end: 1, text: 'Question?', speaker: 'A' }, { start: 0.9, end: 2, text: 'Answer.', speaker: 'B' }], usage: { type: 'tokens', input_tokens: 10, output_tokens: 20 } };
async function setup(id: string) {
  await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'Review','Engineer','hiring',0,0)").bind(id,id).run();
  await bucket.put('audio-' + id, 'fake audio');
  await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,result,created_at) VALUES(?,?,?,?,'ready',?,0)").bind(id,id,id,id,JSON.stringify({ audioKey: 'audio-' + id, sha256: 'a'.repeat(64), durationMs: 2000 })).run();
  await transcriptionIntent(db,id).run();
  return { DB: db, MEDIA: bucket, AUTH_SECRET: 'fake-local', OPENAI_API_KEY: 'fake-api', LOCAL_MEDIA_ADAPTER: 'http://127.0.0.1:8790' };
}
function adapter(paid: () => Promise<Response>): typeof fetch {
  return async input => String(input).includes('/compression/') ? new Response(new Uint8Array([1,2,3]), { headers: { 'content-length': '3' } }) : paid();
}
test('concurrent starts submit once; immutable transcript replays without another charge and is owner-scoped', async () => {
  let calls = 0; const env = await setup('transcript-success');
  const module = createTranscriptionModule(env, adapter(async () => { calls++; return Response.json(provider, { headers: { 'x-request-id': 'req-test' } }); }));
  await Promise.all([module.run('transcript-success'),module.run('transcript-success')]);
  const state = await module.status('transcript-success','transcript-success');
  expect(state?.state).toBe('ready'); expect(state?.transcript?.utterances).toHaveLength(2);
  expect(state?.transcript?.utterances[0]).toMatchObject({ speaker: 'A', overlap: true, startMs: 0 });
  await module.run('transcript-success'); expect(calls).toBe(1);
  expect(await module.status('another-owner','transcript-success')).toBeNull();
  expect(await db.prepare("SELECT state,settled_units FROM processing_budget WHERE id='transcript-transcript-success'").first()).toEqual({ state: 'settled', settled_units: 225 });
});
test('lost response remains unknown and reserved; replay never blindly resubmits', async () => {
  let calls = 0; const env = await setup('transcript-unknown');
  const module = createTranscriptionModule(env, adapter(async () => { calls++; throw new Error('Response lost'); }));
  await module.run('transcript-unknown'); await module.run('transcript-unknown');
  expect(calls).toBe(1); expect((await module.status('transcript-unknown','transcript-unknown'))?.state).toBe('unknown');
  expect(await db.prepare("SELECT state FROM processing_budget WHERE id='transcript-transcript-unknown'").first()).toEqual({ state: 'reserved' });
});
test('deletion during paid transcription discards late content while settling known usage', async () => {
  const env = await setup('transcript-deleted');
  const module = createTranscriptionModule(env, adapter(async () => { await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id='transcript-deleted'").run(); return Response.json(provider); }));
  await module.run('transcript-deleted'); await module.cleanup();
  expect(await module.status('transcript-deleted','transcript-deleted')).toBeNull();
  expect(await bucket.head('transcripts/transcript-deleted/transcript-transcript-deleted.json')).toBeNull();
  expect(await db.prepare("SELECT state FROM processing_budget WHERE id='transcript-transcript-deleted'").first()).toEqual({ state: 'settled' });
});
test('malformed paid output cannot publish; known usage is still settled', async () => {
  const env = await setup('transcript-malformed');
  const module = createTranscriptionModule(env, adapter(async () => Response.json({ ...provider, segments: [{ start: 2, end: 1, text: 'Invalid' }] })));
  await module.run('transcript-malformed'); expect((await module.status('transcript-malformed','transcript-malformed'))?.transcript).toBeNull();
  expect(await db.prepare("SELECT state FROM processing_budget WHERE id='transcript-transcript-malformed'").first()).toEqual({ state: 'settled' });
});
test('validates timestamps and preserves exact text without inventing confidence or word timing', () => {
  const result = parseTranscript(provider,'v1','hash',2000).transcript;
  expect(result.utterances[1].text).toBe('Answer.'); expect(result.utterances[1]).not.toHaveProperty('confidence');
  expect(() => parseTranscript({ ...provider, segments: [{ start: 2.5, end: 2.6, text: 'Outside' }] },'v1','hash',2000)).toThrow();
  expect(() => parseTranscript({ ...provider, segments: [{ start: 1, end: 1.00001, text: 'Collapsed' }] },'v1','hash',2000)).toThrow();
  expect(() => parseTranscript({ ...provider, duration: 20 },'v1','hash',2000)).toThrow();
  expect(() => parseTranscript({ ...provider, segments: [{ start: -1, end: 2, text: 'bad' }] },'v1','hash',2000)).toThrow();
});

test('a completed provider receipt survives a failed billing settlement and is never resubmitted', async () => {
  const env = await setup('transcript-overage'); let calls = 0;
  const module = createTranscriptionModule(env, adapter(async () => { calls++; return Response.json({ ...provider, usage: { type: 'tokens', input_tokens: 3000000, output_tokens: 0 } }); }));
  await module.run('transcript-overage'); await module.run('transcript-overage');
  expect(calls).toBe(1); expect((await module.status('transcript-overage','transcript-overage'))?.state).toBe('reconciliation');
  expect(await bucket.head('transcripts/transcript-overage/transcript-transcript-overage.provider.json')).not.toBeNull();
  expect(await db.prepare("SELECT state FROM processing_budget WHERE id='transcript-transcript-overage'").first()).toEqual({ state: 'reserved' });
});
