import {createPreparationRetry} from '../server/preparation-retry';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createProcessingModule, createBudgetLedger } from '../server/processing';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
let db: D1Database; let bucket: R2Bucket;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database; bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
});
afterAll(() => runtime.dispose());
async function queued(id: string, owner: string) {
  await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'Test','Engineer','mock',0,0)").bind(id, owner).run();
  await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,created_at) VALUES(?,?,?,?,0)").bind(id, id, owner, id).run();
}
test('concurrent dispatch claims one account slot and recovers a lost response with the same workflow ID', async () => {
  await queued('job-a', 'owner-a'); await queued('job-b', 'owner-a');
  const calls: string[] = []; let canCancel=false;
  const module = createProcessingModule({ DB: db, MEDIA: bucket }, async id => { calls.push(id); if (calls.length === 1) throw new Error('Response lost after dispatch'); },async()=>{if(!canCancel)throw new Error('Cancellation unavailable');});
  await Promise.all([module.reconcile(), module.reconcile()]);
  expect(new Set(calls).size).toBe(1);
  await module.reconcile(); expect(new Set(calls).size).toBe(1);
  await module.fail(calls[0], 'Synthetic failure'); await module.reconcile();
  expect(new Set(calls).size).toBe(1);
  canCancel=true;await module.reconcile();expect(new Set(calls).size).toBe(2);
});
test('budget reservations are atomic and uncertain charges remain reserved', async () => {
  const ledger = createBudgetLedger(db);
  const reservations = await Promise.all([ledger.reserve('cost-a', 'probe', 30000000), ledger.reserve('cost-b', 'probe', 30000000)]);
  expect(reservations.filter(Boolean)).toHaveLength(1);
  expect(await ledger.reserve('cost-c', 'probe', 21000000)).toBe(false);
  const id = reservations[0] ? 'cost-a' : 'cost-b';
  await ledger.settle(id, 10000000);
  expect(await ledger.reserve('cost-c', 'probe', 21000000)).toBe(true);
  await expect(ledger.settle('cost-c', 22000000)).rejects.toThrow();
});
test('cancelled review and expired stage cannot publish preparation', async () => {
  await queued('job-deleted', 'owner-deleted');
  const module = createProcessingModule({ DB: db, MEDIA: bucket }, async () => {});
  await module.reconcile(); await module.cancelReview('owner-deleted', 'job-deleted');
  expect((await module.status('owner-deleted', 'job-deleted'))?.state).toBe('cancelled');
  await expect(module.prepare('job-deleted')).rejects.toThrow();
});

test('preparation hashes actual audio and reuses its checkpoint; stale revisions cannot publish', async () => {
  await queued('job-valid', 'owner-valid');
  const bytes = new Uint8Array(100); const header = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) bytes.set(new TextEncoder().encode(value), offset);
  header.setUint32(4, 92, true); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true); header.setUint32(40, 56, true);
  await bucket.put('test-source', bytes, { httpMetadata: { contentType: 'audio/wav' } });
  await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at,admitted_at) VALUES('job-valid','owner-valid','job-valid','action-valid','test.wav',100,'admitted','test-source',0,0,1)").run();
  const module = createProcessingModule({ DB: db, MEDIA: bucket }, async () => {}); await module.reconcile();
  const result = await module.prepare('job-valid'); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/); expect(result.bytes).toBe(100);
  await bucket.delete('test-source'); expect(await module.prepare('job-valid')).toEqual(result);
  await db.prepare("UPDATE reviews SET input_revision=2 WHERE id='job-valid'").run();
  await expect(module.prepare('job-valid')).rejects.toThrow();
});

test('an expired active job releases its slot only after cancellation and cannot resume publication', async () => {
  await queued('job-timeout', 'owner-timeout'); await queued('job-next', 'owner-timeout');
  const module = createProcessingModule({ DB: db, MEDIA: bucket }, async () => {},async()=>{}); await module.reconcile();
  const active = await db.prepare("SELECT id FROM processing_jobs WHERE owner_id='owner-timeout' AND state='running'").first<{ id: string }>();
  await db.prepare('UPDATE processing_jobs SET deadline=0 WHERE id=?').bind(active!.id).run(); await module.reconcile();
  expect((await db.prepare('SELECT state FROM processing_jobs WHERE id=?').bind(active!.id).first<{ state: string }>())?.state).toBe('failed');
  await expect(module.prepare(active!.id)).rejects.toThrow();
  expect((await db.prepare("SELECT COUNT(*) AS count FROM processing_jobs WHERE owner_id='owner-timeout' AND state='running'").first<{ count: number }>())?.count).toBe(0);
  await module.reconcile();
expect((await db.prepare("SELECT COUNT(*) AS count FROM processing_jobs WHERE owner_id='owner-timeout' AND state='running'").first<{ count: number }>())?.count).toBe(1);
});

test('conflicting concurrent settlements cannot both succeed; identical retries are idempotent', async () => {
  const ledger = createBudgetLedger(db); expect(await ledger.reserve('settlement-race', 'probe', 1000)).toBe(true);
  const results = await Promise.allSettled([ledger.settle('settlement-race', 100), ledger.settle('settlement-race', 200)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const row = await db.prepare("SELECT settled_units FROM processing_budget WHERE id='settlement-race'").first<{ settled_units: number }>();
  await ledger.settle('settlement-race', row!.settled_units);
});

test('failed cancellation attempts do not starve later workflows, and invalidation requests termination', async () => {
  await db.prepare("UPDATE processing_jobs SET cancellation_attempted_at=9999999999999 WHERE dispatch_state='cancel_pending'").run();
  for (let n = 0; n < 26; n++) await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,dispatch_state,created_at) VALUES(?,?,?,?,'cancelled','cancel_pending',0)").bind(`cancel-${String(n).padStart(2, '0')}`, `cancel-r-${n}`, 'cancel-owner', `cancel-u-${n}`).run();
  const terminated: string[] = [];
  const module = createProcessingModule({ DB: db, MEDIA: bucket }, undefined, async id => { if (id !== 'cancel-25') throw new Error('Unavailable instance'); terminated.push(id); });
  await module.reconcile(); await module.reconcile(); expect(terminated).toContain('cancel-25');
  await queued('job-invalidated', 'owner-invalidated');
  const running = createProcessingModule({ DB: db, MEDIA: bucket }, async () => {}); await running.reconcile();
  await db.prepare("UPDATE reviews SET input_revision=2 WHERE id='job-invalidated'").run(); await running.reconcile();
  expect(await db.prepare("SELECT state,dispatch_state FROM processing_jobs WHERE id='job-invalidated'").first()).toMatchObject({ state: 'cancelled', dispatch_state: 'cancel_pending' });
});

test('overlapping video attempts cannot delete the winning derivative and invalid media releases admission', async () => {
  const id = 'job-video-race'; await queued(id, 'owner-video-race');
  await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at) VALUES(?,?,?,?,?,100,'validating',?,9999999999999,0)").bind(id, 'owner-video-race', id, 'action-video', 'source.mp4', 'video-source').run();
  await bucket.put('video-source', new Uint8Array(100));
  const wav = new Uint8Array(100); const view = new DataView(wav.buffer);
  for (const [offset, text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const) wav.set(new TextEncoder().encode(text), offset);
  view.setUint32(4,92,true); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true); view.setUint32(40,56,true);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(wav));
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const firstPut = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  const originalPut = bucket.put.bind(bucket);
  const observedBucket = new Proxy(bucket, { get(target, property) {
    if (property === 'put') return async (key: string, body: ReadableStream, options: R2PutOptions) => { if (++calls === 1) { entered(); await blocked; } if (key.startsWith('audio/video-expiry/')) await db.prepare("UPDATE uploads SET expires_at=0 WHERE id='video-expiry'").run();
      return originalPut(key, await new Response(body).arrayBuffer(), options); };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    const module = createProcessingModule({ DB: db, MEDIA: observedBucket, LOCAL_MEDIA_ADAPTER: 'http://127.0.0.1:8790', AUTH_SECRET: 'test' }, async () => {});
    await module.reconcile(); const older = module.prepare(id); const outcome = older.catch(error => error);
    await Promise.race([firstPut, outcome.then(value => { throw value; })]); const winner = await module.prepare(id); release(); expect(await outcome).toBeInstanceOf(Error);
    expect(await bucket.head(winner.audioKey!)).not.toBeNull(); expect(await bucket.head('video-source')).not.toBeNull();
    expect(winner.sourceSha256).not.toBe(winner.sha256);
    expect(await db.prepare('SELECT state,admitted_at FROM uploads WHERE id=?').bind(id).first()).toMatchObject({ state: 'admitted', admitted_at: expect.any(Number) });
    await queued('video-expiry', 'video-expiry-owner'); await originalPut('expiry-source', new Uint8Array(100));
    await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at) VALUES('video-expiry','video-expiry-owner','video-expiry','expiry','expiry.mp4',100,'validating','expiry-source',9999999999999,0)").run();
    await module.reconcile(); await expect(module.prepare('video-expiry')).rejects.toThrow('cancelled or superseded');
    expect((await module.status('video-expiry-owner', 'video-expiry'))?.state).not.toBe('ready');
    expect(await db.prepare("SELECT admitted_at FROM uploads WHERE id='video-expiry'").first()).toEqual({ admitted_at: null });
    await db.prepare("UPDATE processing_jobs SET deadline=0 WHERE id='video-expiry'").run(); await module.reconcile();
    expect(await db.prepare("SELECT state,expires_at FROM uploads WHERE id='video-expiry'").first()).toEqual({ state: 'rejected', expires_at: 0 });
    await queued('invalid-video', 'invalid-video-owner');
    await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at) VALUES('invalid-video','invalid-video-owner','invalid-video','bad-video','bad.mp4',100,'validating','bad-source',9999999999999,0)").run();
    await originalPut('bad-source',new Uint8Array(100));fetcher.mockResolvedValueOnce(new Response('No audio track.',{status:422}));
    await module.reconcile();await expect(module.prepare('invalid-video')).rejects.toThrow('No audio track.'); await module.fail('invalid-video', 'No audio track.');
    expect(await db.prepare("SELECT state,admitted_at,expires_at FROM uploads WHERE id='invalid-video'").first()).toEqual({ state: 'rejected', admitted_at: null, expires_at: 0 });
  } finally { release(); fetcher.mockRestore(); }
});

function retryWave(){
 const wav=new Uint8Array(100),view=new DataView(wav.buffer);
 for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)wav.set(new TextEncoder().encode(text),offset);
 view.setUint32(4,92,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,56,true);return wav;
}
async function retryVideo(id:string){
 await queued(id,id);await bucket.put('source-'+id,new Uint8Array(100));
 await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at) VALUES(?,?,?,?,'source.mp4',100,'validating',?,9999999999999,0)").bind(id,id,id,id,'source-'+id).run();
 const media=new Proxy(bucket,{get(target,property){if(property==='put')return async(key:string,body:ReadableStream,options:R2PutOptions)=>target.put(key,await new Response(body).arrayBuffer(),options);const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 return {DB:db,MEDIA:media,LOCAL_MEDIA_ADAPTER:'http://127.0.0.1:8790',AUTH_SECRET:'test'};
}
test('temporary preparation failure retains the upload and duplicate retries reuse one new attempt',async()=>{
 const id='retry-video',env=await retryVideo(id),calls:string[]=[];
 const processing=createProcessingModule(env,async(job,attempt)=>{if(job===id)calls.push(job+':'+attempt);},async()=>{});
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('Unavailable',{status:503})).mockImplementation(async()=>new Response(retryWave()));
 try{
  await processing.reconcile();await expect(processing.prepare(id)).rejects.toThrow('Unavailable');await processing.fail(id,'Unavailable');
  expect(await db.prepare('SELECT state FROM uploads WHERE id=?').bind(id).first()).toEqual({state:'validating'});
  const retry=createPreparationRetry(env,processing),input={actionId:crypto.randomUUID(),jobId:id,attempt:0};
  await Promise.all([retry.retry(id,id,input),retry.retry(id,id,input)]);
  expect(calls).toEqual([id+':0',id+':1']);
  await expect(processing.prepare(id,0)).rejects.toThrow('no longer active');
  await processing.fail(id,'Late failure from old attempt',0);expect((await processing.status(id,id))?.state).toBe('running');
  const result=await processing.prepare(id,1);expect(result.bytes).toBe(100);
  expect(await db.prepare('SELECT state,admitted_at FROM uploads WHERE id=?').bind(id).first()).toMatchObject({state:'admitted',admitted_at:expect.any(Number)});
  await retry.retry(id,id,input);expect(calls).toHaveLength(2);
 }finally{fetcher.mockRestore();}
});
test('preparation retries wait for confirmed cancellation and reject deleted or exhausted work',async()=>{
 const id='retry-cancellation',env=await retryVideo(id),input={actionId:crypto.randomUUID(),jobId:id,attempt:0};
 const processing=createProcessingModule(env,async()=>{},async()=>{throw new Error('Cancellation unavailable');});
 await processing.reconcile();await processing.fail(id);await expect(createPreparationRetry(env,processing).retry(id,id,input)).rejects.toThrow('cancellation is pending');
 expect(await db.prepare('SELECT attempt FROM processing_jobs WHERE id=?').bind(id).first()).toEqual({attempt:0});
 await db.prepare("UPDATE processing_jobs SET attempt=2,dispatch_state='cancelled' WHERE id=?").bind(id).run();
 await expect(createPreparationRetry(env,processing).retry(id,id,{...input,attempt:2})).rejects.toThrow('attempt limit');
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();
 await expect(createPreparationRetry(env,processing).retry(id,id,input)).rejects.toThrow('Review not found');
});
test('a delayed older preparation response cannot replace the retry result',async()=>{
 const id='retry-delayed',env=await retryVideo(id);let release!:(value:Response)=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>{entered=resolve;});let count=0;
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{if(++count===1){entered();return new Promise<Response>(resolve=>{release=resolve;});}return new Response(retryWave());});
 const processing=createProcessingModule(env,async()=>{},async()=>{});
 try{
  await processing.reconcile();const old=processing.prepare(id).catch(error=>error);await waiting;
  await processing.fail(id,'Interrupted');await createPreparationRetry(env,processing).retry(id,id,{actionId:crypto.randomUUID(),jobId:id,attempt:0});
  const winner=await processing.prepare(id,1);release(new Response(retryWave()));expect(await old).toBeInstanceOf(Error);
  expect((await processing.status(id,id))?.result).toEqual(winner);expect(await bucket.head(winner.audioKey!)).not.toBeNull();
 }finally{release?.(new Response(retryWave()));fetcher.mockRestore();}
});
test('lost preparation dispatch has a three-attempt bound and a deadline',async()=>{
 const id='retry-dispatch-bound';await queued(id,id);let calls=0;
 const processing=createProcessingModule({DB:db,MEDIA:bucket},async job=>{if(job===id){calls++;throw new Error('Lost response');}},async()=>{});
 for(let attempt=0;attempt<5;attempt++){await db.prepare('UPDATE processing_jobs SET dispatch_started_at=0 WHERE id=?').bind(id).run();await processing.reconcile();}
 expect(calls).toBe(3);await db.prepare('UPDATE processing_jobs SET deadline=0 WHERE id=?').bind(id).run();await processing.reconcile();
 expect((await processing.status(id,id))?.state).toBe('failed');await expect(processing.prepare(id)).rejects.toThrow('no longer active');
});
