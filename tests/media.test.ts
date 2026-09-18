import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createReviewModule } from '../server/reviews';
import { createMediaModule } from '../server/media';
import { PART_BYTES } from '../lib/media/contracts';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
let media: ReturnType<typeof createMediaModule>;
let reviews: ReturnType<typeof createReviewModule>;
let db: D1Database;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await db.prepare(statement).run();
    }
  }
  media = createMediaModule({ DB: db, MEDIA: await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket, AUTH_SECRET: 'isolated-media-test-secret', RECORDING_ALLOWANCE: '3' });
  reviews = createReviewModule(db);
});
afterAll(() => runtime.dispose());
function wav(size = PART_BYTES + 44) {
  const bytes = new Uint8Array(size); const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) bytes.set(new TextEncoder().encode(value), offset);
  view.setUint32(4, size - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, size - 44, true);
  return bytes;
}
async function review(owner: string) { return reviews.create(owner, { title: 'Private recording', role: 'Engineer', origin: 'hiring' }); }
async function upload(owner: string, reviewId: string, bytes = wav()) {
  const current = await media.initiate(owner, reviewId, { name: 'recording.wav', size: bytes.length, actionId: crypto.randomUUID() });
  for (let number = 1; number <= Math.ceil(bytes.length / PART_BYTES); number++) {
    const capability = await media.signPart(owner, reviewId, current.id, number);
    await media.putPart(owner, reviewId, current.id, number, capability.token, bytes.slice((number - 1) * PART_BYTES, number * PART_BYTES));
  }
  return current;
}
test('multipart state survives reload, completion is idempotent, and ranged audio is private', async () => {
  const r = await review('audio-owner'); const bytes = wav();
  const u = await upload('audio-owner', r.id, bytes);
  expect((await media.status('audio-owner', r.id)).upload?.parts).toHaveLength(2);
  await Promise.all([media.complete('audio-owner', r.id, u.id), media.complete('audio-owner', r.id, u.id)]);
  expect((await media.status('audio-owner', r.id)).admitted).toBe(1);
  const playback = await media.play('audio-owner', r.id, 'bytes=0-43');
  expect(playback.status).toBe(206); expect(playback.headers.get('content-range')).toBe(`bytes 0-43/${bytes.length}`);
  expect(new Uint8Array(await playback.arrayBuffer())).toEqual(bytes.slice(0, 44));
  expect((await media.play('audio-owner', r.id, 'bytes=999999999-')).status).toBe(416);
  await expect(media.play('stranger', r.id, null)).rejects.toMatchObject({ status: 404 });
});
test('a 60-minute WAV uploads in parts and its final sample remains playable; longer audio is rejected', async () => {
  const r = await review('duration-owner');
  const bytes = wav(3600 * 32000 + 44);
  // A nonzero final sample proves that playback reaches the end of the object.
  bytes[bytes.length - 2] = 123;
  const u = await upload('duration-owner', r.id, bytes);
  await media.complete('duration-owner', r.id, u.id);
  const end = await media.play('duration-owner', r.id, `bytes=${bytes.length - 2}-`);
  expect(end.status).toBe(206);
  expect(new Uint8Array(await end.arrayBuffer())).toEqual(new Uint8Array([123, 0]));
  const tooLong = await review('duration-owner');
  const invalid = await upload('duration-owner', tooLong.id, wav(3601 * 32000 + 44));
  await expect(media.complete('duration-owner', tooLong.id, invalid.id)).rejects.toMatchObject({ status: 422 });
  expect((await media.status('duration-owner', tooLong.id)).reserved).toBe(0);
}, 120000);
test('concurrent admissions cannot exceed allowance; expired reservations release and deletion does not replenish', async () => {
  const rs = await Promise.all(Array.from({ length: 4 }, () => review('quota-owner')));
  const attempts = await Promise.allSettled(rs.map(r => media.initiate('quota-owner', r.id, { name: 'test.wav', size: 100, actionId: crypto.randomUUID() })));
  expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(3);
  await db.prepare("UPDATE uploads SET expires_at=0 WHERE owner_id='quota-owner'").run();
  const r = rs[0]; const u = await upload('quota-owner', r.id, wav(100)); await media.complete('quota-owner', r.id, u.id);
  await media.remove('quota-owner', r.id);
  expect(await reviews.get('quota-owner', r.id)).toBeNull();
  expect((await media.status('quota-owner', rs[3].id)).admitted).toBe(1);
});
test('deletion invalidates issued capabilities and late completion cannot restore the review', async () => {
  const r = await review('delete-owner'); const u = await upload('delete-owner', r.id, wav(100));
  const signed = await media.signPart('delete-owner', r.id, u.id, 1);
  await media.remove('delete-owner', r.id);
  await expect(media.putPart('delete-owner', r.id, u.id, 1, signed.token, wav(100))).rejects.toMatchObject({ status: 404 });
  await expect(media.complete('delete-owner', r.id, u.id)).rejects.toMatchObject({ status: 404 });
  expect(await reviews.get('delete-owner', r.id)).toBeNull();
});

test('invalid media releases reservation and forged or expired part permissions cannot write', async () => {
  const r = await review('invalid-owner'); const bytes = new Uint8Array(100);
  const u = await media.initiate('invalid-owner', r.id, { name: 'invalid.wav', size: bytes.length, actionId: crypto.randomUUID() });
  await expect(media.putPart('invalid-owner', r.id, u.id, 1, '1.' + '0'.repeat(64), bytes)).rejects.toMatchObject({ status: 403 });
  const signed = await media.signPart('invalid-owner', r.id, u.id, 1);
  await media.putPart('invalid-owner', r.id, u.id, 1, signed.token, bytes);
  await expect(media.complete('invalid-owner', r.id, u.id)).rejects.toMatchObject({ status: 422 });
  const state = await media.status('invalid-owner', r.id);
  expect(state.admitted).toBe(0); expect(state.reserved).toBe(0);
  expect(await (await runtime.getR2Bucket('MEDIA')).head('originals/' + u.id)).toBeNull();
});

test('cleanup removes admitted audio and a new review cannot reuse its admission', async () => {
  const r = await review('erase-owner'); const u = await upload('erase-owner', r.id, wav(100));
  await media.complete('erase-owner', r.id, u.id);
  await media.remove('erase-owner', r.id);
  await media.cleanup();
  expect(await (await runtime.getR2Bucket('MEDIA')).head('originals/' + u.id)).toBeNull();
  await expect(media.play('erase-owner', r.id, null)).rejects.toMatchObject({ status: 404 });
  const fresh = await review('erase-owner'); expect((await media.status('erase-owner', fresh.id)).admitted).toBe(1);
});

test('deletion racing multipart completion leaves no readable or stored recording', async () => {
  const r = await review('race-owner'); const u = await upload('race-owner', r.id, wav(100));
  const bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  let reached!: () => void; const started = new Promise<void>(resolve => { reached = resolve; });
  let release!: () => void; const proceed = new Promise<void>(resolve => { release = resolve; });
  const racingBucket = new Proxy(bucket, { get(target, prop) {
    if (prop === 'resumeMultipartUpload') return (key: string, id: string) => {
      const multipart = target.resumeMultipartUpload(key, id);
      return { ...multipart, uploadPart: multipart.uploadPart.bind(multipart), abort: multipart.abort.bind(multipart), complete: async (parts: R2UploadedPart[]) => {
        const result = await multipart.complete(parts); reached(); await proceed; return result;
      } };
    };
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const racing = createMediaModule({ DB: db, MEDIA: racingBucket, AUTH_SECRET: 'race-test' });
  const completion = racing.complete('race-owner', r.id, u.id);
  await started; await media.remove('race-owner', r.id); release();
  await expect(completion).rejects.toBeDefined(); await media.cleanup();
  expect(await bucket.head('originals/' + u.id)).toBeNull();
  expect(await reviews.get('race-owner', r.id)).toBeNull();
});

test('a superseded completion cannot erase audio admitted by a newer attempt', async () => {
  const r = await review('fence-owner'); const u = await upload('fence-owner', r.id, wav(100));
  const bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  let reached!: () => void; const started = new Promise<void>(resolve => { reached = resolve; });
  let release!: () => void; const proceed = new Promise<void>(resolve => { release = resolve; });
  const delayed = new Proxy(bucket, { get(target, prop) {
    if (prop === 'get') return async (key: string, options: R2GetOptions) => { const object = await target.get(key, options); reached(); await proceed; return object; };
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const first = createMediaModule({ DB: db, MEDIA: delayed, AUTH_SECRET: 'completion-race' }).complete('fence-owner', r.id, u.id);
  await started; await db.prepare('UPDATE uploads SET lock_until=0 WHERE id=?').bind(u.id).run();
  await media.complete('fence-owner', r.id, u.id);
  await db.prepare('UPDATE uploads SET expires_at=0 WHERE id=?').bind(u.id).run();
  release(); await first;
  expect((await media.play('fence-owner', r.id, 'bytes=0-43')).status).toBe(206);
  expect((await media.status('fence-owner', r.id)).admitted).toBe(1);
});

test('failed cleanup reports pending and does not starve later tombstones', async () => {
  const r = await review('cleanup-owner'); const u = await upload('cleanup-owner', r.id, wav(100)); await media.complete('cleanup-owner', r.id, u.id);
  const bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  const failing = new Proxy(bucket, { get(target, prop) {
    if (prop === 'delete') return async (key: string | string[]) => { if ((Array.isArray(key) ? key : [key]).some(value => value.includes(u.id) || value.startsWith('fail/'))) throw new Error('Transient storage outage'); return target.delete(key); };
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const cleaner = createMediaModule({ DB: db, MEDIA: failing, AUTH_SECRET: 'cleanup-test' });
  expect(await cleaner.remove('cleanup-owner', r.id)).toEqual({ cleanupPending: true });
  await expect(media.play('cleanup-owner', r.id, null)).rejects.toMatchObject({ status: 404 });
  await media.remove('cleanup-owner', r.id);
  expect(await media.deletionStatus('cleanup-owner', r.id)).toEqual({ cleanupPending: false });
  await db.prepare("UPDATE uploads SET cleanup_attempted_at=9999999999999 WHERE state='cleanup'").run();
  for (let n = 0; n < 26; n++) await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at) VALUES(?, 'fair-owner','fair-review',?,'',100,'cleanup',?,0,?)").bind(`fair-${n}`, `fair-${n}`, n < 25 ? `fail/${n}` : 'good/last', n).run();
  await cleaner.cleanup(); await cleaner.cleanup();
  expect((await db.prepare("SELECT cleaned_at FROM uploads WHERE id='fair-25'").first<{ cleaned_at: number }>())?.cleaned_at).toBeGreaterThan(0);
});

test('hosted R2 completion can omit metadata while the stored WAV remains valid', async () => {
  const owner = 'remote-completion-owner';
  const r = await review(owner); const bytes = wav(100);
  const u = await upload(owner, r.id, bytes);
  const bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  const remoteShape = new Proxy(bucket, { get(target, prop) {
    if (prop === 'resumeMultipartUpload') return (key: string, id: string) => {
      const multipart = target.resumeMultipartUpload(key, id);
      return { ...multipart, uploadPart: multipart.uploadPart.bind(multipart), abort: multipart.abort.bind(multipart), complete: async (parts: R2UploadedPart[]) => {
        const result = await multipart.complete(parts);
        // Observed on real preview R2: complete() omits HTTP metadata; HEAD has it.
        return { ...result, httpMetadata: undefined };
      } };
    };
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const hosted = createMediaModule({DB:db,MEDIA:remoteShape,AUTH_SECRET:'isolated-media-test-secret'});
  expect((await hosted.complete(owner,r.id,u.id)).state).toBe('admitted');
  expect((await hosted.status(owner,r.id)).admitted).toBe(1);
  expect(new Uint8Array(await (await hosted.play(owner,r.id,'bytes=0-43')).arrayBuffer())).toEqual(bytes.slice(0,44));
});

test('multipart billing read failure keeps deletion pending until the receipt can be reconciled',async()=>{
 const owner='part-cleanup-owner',r=await review(owner),u=await upload(owner,r.id,wav(100));await media.complete(owner,r.id,u.id);
 const bucket=await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
 const job=await db.prepare('SELECT id FROM processing_jobs WHERE upload_id=?').bind(u.id).first<{id:string}>();
 const id='transcript-'+job!.id,receipt=`transcripts/${r.id}/${id}-part-0.provider.json`;
 await db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state) VALUES(?,?,?,?,1,'unknown')").bind(id,r.id,owner,job!.id).run();
 await db.prepare("INSERT INTO transcription_parts(transcription_id,part_index,offset_ms,duration_ms,source_sha256,audio_key,state,provider_identity,receipt_key,submitted_at) VALUES(?,0,0,1000,? ,?,'unknown',?,?,1)").bind(id,'a'.repeat(64),`audio/${u.id}/${id}/part-0.mp3`,id+'-part-0',receipt).run();
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES(?,'openai-diarization-v1',6000000)").bind(id).run();
 await bucket.put(receipt,JSON.stringify({response:JSON.stringify({usage:{type:'tokens',input_tokens:1,output_tokens:0}})}));
 const failing=new Proxy(bucket,{get(target,key){if(key==='get')return async(name:string)=>{if(name===receipt)throw new Error('Receipt unavailable');return target.get(name);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 expect(await createMediaModule({DB:db,MEDIA:failing,AUTH_SECRET:'cleanup-test'}).remove(owner,r.id)).toEqual({cleanupPending:true});
 expect(await bucket.head(receipt)).not.toBeNull();
 await media.remove(owner,r.id);
 expect(await media.deletionStatus(owner,r.id)).toEqual({cleanupPending:false});
 expect(await bucket.head(receipt)).toBeNull();
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(id).first()).toEqual({settled_units:3});
});
