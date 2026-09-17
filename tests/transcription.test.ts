import {createProcessingModule} from '../server/processing';
import {createTranscriptionRetry} from '../server/transcription-retry';
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
  await module.run('transcript-unknown'); await module.run('transcript-unknown'); await module.recoverReceipt('transcript-transcript-unknown');
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

test('database publication retries replay the saved provider receipt without another paid request',async()=>{
 const id='publication-retry',env=await setup(id);let fail=true,calls=0;
 const failingDB=new Proxy(db,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith("UPDATE transcriptions SET state='ready'"))return statement;return {bind:(...values:unknown[])=>{const bound=statement.bind(...values);return {run:async()=>{if(fail){fail=false;throw new Error('Database unavailable');}return bound.run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const module=createTranscriptionModule({...env,DB:failingDB},adapter(async()=>{calls++;return Response.json(provider);}));await module.run(id);expect((await module.status(id,id))?.state).toBe('reconciliation');
 await Promise.all([module.recoverReceipt('transcript-'+id),module.recoverReceipt('transcript-'+id)]);expect((await module.status(id,id))?.state).toBe('ready');expect(calls).toBe(1);expect(await db.prepare('SELECT publication_attempts FROM transcriptions WHERE id=?').bind('transcript-'+id).first()).toEqual({publication_attempts:1});
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind('transcript-'+id).first()).toEqual({settled_units:225});
});
test('explicit recovery republishes an exhausted saved transcript without another charge',async()=>{
 const id='publication-explicit',env=await setup(id);let fail=true,calls=0;
 const failingDB=new Proxy(db,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith("UPDATE transcriptions SET state='ready'"))return statement;return {bind:(...values:unknown[])=>{const bound=statement.bind(...values);return {run:async()=>{if(fail)throw new Error('Database unavailable');return bound.run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const module=createTranscriptionModule({...env,DB:failingDB},adapter(async()=>{calls++;return Response.json(provider);}));await module.run(id);
 for(let i=0;i<4;i++)await module.recoverReceipt('transcript-'+id);
 expect((await module.status(id,id))?.state).toBe('reconciliation_exhausted');
 const action={actionId:crypto.randomUUID(),transcriptId:'transcript-'+id,attempt:0};
 const retry=createTranscriptionRetry({DB:db,MEDIA:bucket});
 await Promise.all([retry.retry(id,id,action),retry.retry(id,id,action)]);
 fail=false;await module.reconcileReceipts();
 expect((await module.status(id,id))?.state).toBe('ready');expect(calls).toBe(1);
 expect(await db.prepare('SELECT paid_attempt,publication_retries FROM transcriptions WHERE id=?').bind(action.transcriptId).first()).toEqual({paid_attempt:0,publication_retries:1});
 expect(await db.prepare('SELECT id FROM processing_budget WHERE id=?').bind(action.transcriptId+'-attempt-1').first()).toBeNull();
 await retry.retry(id,id,action);expect((await module.status(id,id))?.state).toBe('ready');
});


test('receipt publication and ordinary dispatch cannot own different reviews on the same account concurrently',async()=>{
 const id='publication-slot',env=await setup(id),module=createTranscriptionModule(env,adapter(async()=>Response.json(provider)));await module.run(id);
 await db.prepare("UPDATE transcriptions SET state='reconciliation',result_key=NULL WHERE id=?").bind('transcript-'+id).run();
 await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES('publication-slot-other',?,'Review','Engineer','mock',0,0)").bind(id).run();
 await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,created_at) VALUES('publication-slot-job','publication-slot-other',?,'other-upload',0)").bind(id).run();
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),publishing=new Promise<void>(resolve=>{started=resolve;});
 const pausedBucket=new Proxy(bucket,{get(target,property){if(property==='put')return async(key:string,value:string,options:R2PutOptions)=>{started();await gate;return target.put(key,value,options);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const replay=createTranscriptionModule({...env,MEDIA:pausedBucket}).recoverReceipt('transcript-'+id);await publishing;
 const processing=createProcessingModule(env,async()=>{},async()=>{});
 try{await processing.reconcile();expect(await db.prepare("SELECT state FROM processing_jobs WHERE id='publication-slot-job'").first()).toEqual({state:'queued'});}finally{release();await replay;}
 await processing.reconcile();expect(await db.prepare("SELECT state FROM processing_jobs WHERE id='publication-slot-job'").first()).toEqual({state:'running'});
 await db.prepare("UPDATE transcriptions SET state='reconciliation',result_key=NULL,publication_attempts=0 WHERE id=?").bind('transcript-'+id).run();
 await module.recoverReceipt('transcript-'+id);expect(await db.prepare('SELECT state,publication_attempts FROM transcriptions WHERE id=?').bind('transcript-'+id).first()).toEqual({state:'reconciliation',publication_attempts:0});
 await processing.fail('publication-slot-job','Synthetic failure');await processing.reconcile();await module.recoverReceipt('transcript-'+id);expect((await module.status(id,id))?.state).toBe('ready');
});
test('invalid stored receipts exhaust a finite publication budget without resubmission',async()=>{
 const id='publication-exhausted',env=await setup(id);let calls=0;const module=createTranscriptionModule(env,adapter(async()=>{calls++;return Response.json({...provider,segments:[{start:2,end:1,text:'Invalid'}]});}));
 await module.run(id);for(let i=0;i<6;i++)await module.recoverReceipt('transcript-'+id);
 expect(calls).toBe(1);expect(await db.prepare('SELECT state,publication_attempts FROM transcriptions WHERE id=?').bind('transcript-'+id).first()).toEqual({state:'reconciliation_exhausted',publication_attempts:3});expect(await bucket.head(`transcripts/${id}/transcript-${id}.provider.json`)).not.toBeNull();
 const retry=createTranscriptionRetry({DB:db,MEDIA:bucket});
 for(let cycle=0;cycle<2;cycle++){
  await retry.retry(id,id,{actionId:crypto.randomUUID(),transcriptId:'transcript-'+id,attempt:0,publicationCycle:cycle});
  for(let i=0;i<4;i++)await module.recoverReceipt('transcript-'+id);
 }
 await expect(retry.retry(id,id,{actionId:crypto.randomUUID(),transcriptId:'transcript-'+id,attempt:0,publicationCycle:2})).rejects.toThrow('three-window limit');
 expect(calls).toBe(1);expect((await module.status(id,id))?.retry.canRetry).toBe(false);
});
test('deletion while replaying a saved receipt cannot restore transcript artifacts',async()=>{
 const id='publication-deleted',env=await setup(id);const module=createTranscriptionModule(env,adapter(async()=>Response.json(provider)));await module.run(id);await db.prepare("UPDATE transcriptions SET state='reconciliation',result_key=NULL WHERE id=?").bind('transcript-'+id).run();
 const deletingBucket=new Proxy(bucket,{get(target,property){if(property==='put')return async(key:string,value:string,options:R2PutOptions)=>{await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();return target.put(key,value,options);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const recovery=createTranscriptionModule({...env,MEDIA:deletingBucket});await recovery.recoverReceipt('transcript-'+id);await recovery.cleanup();expect(await recovery.status(id,id)).toBeNull();expect(await bucket.head(`transcripts/${id}/transcript-${id}.json`)).toBeNull();expect(await bucket.head(`transcripts/${id}/transcript-${id}.provider.json`)).toBeNull();
});
test('scheduled receipt recovery respects its elapsed deadline and skips an unavailable receipt',async()=>{
 const expired='publication-deadline',later='publication-scheduled';
 for(const id of [expired,later]){const env=await setup(id);await createTranscriptionModule(env,adapter(async()=>Response.json(provider))).run(id);await db.prepare("UPDATE transcriptions SET state='reconciliation',result_key=NULL WHERE id=?").bind('transcript-'+id).run();}
 await db.prepare('UPDATE transcriptions SET publication_deadline=1 WHERE id=?').bind('transcript-'+expired).run();
 const recovering=createTranscriptionModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-local'});await recovering.reconcileReceipts();
 expect((await recovering.status(expired,expired))?.state).toBe('reconciliation_exhausted');expect((await recovering.status(later,later))?.state).toBe('ready');
 expect(await db.prepare('SELECT publication_attempts FROM transcriptions WHERE id=?').bind('transcript-'+expired).first()).toEqual({publication_attempts:0});
 expect((await recovering.status('transcript-unknown','transcript-unknown'))?.state).toBe('unknown');
});

test('a new paid attempt uses a separate reservation and receipt while reusing prepared audio',async()=>{
 const id='attempt-identity',env=await setup(id);let calls=0;
 const module=createTranscriptionModule(env,adapter(async()=>{calls++;return calls===1?new Response('Quota',{status:429}):Response.json(provider);}));
 await module.run(id);
 expect((await module.status(id,id))?.state).toBe('failed');
 await db.prepare("UPDATE transcriptions SET state='queued',paid_attempt=1 WHERE id=?").bind('transcript-'+id).run();
 await Promise.all([module.run(id),module.run(id)]);
 expect(calls).toBe(2);expect((await module.status(id,id))?.state).toBe('ready');
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind('transcript-'+id).first()).toEqual({settled_units:0});
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind('transcript-'+id+'-attempt-1').first()).toEqual({settled_units:225});
 expect(await bucket.head(`transcripts/${id}/transcript-${id}-attempt-1.provider.json`)).not.toBeNull();
});
test('missing configuration releases an explicitly reserved attempt before any submission',async()=>{
 const id='attempt-configuration',env=await setup(id);
 await db.prepare("UPDATE transcriptions SET paid_attempt=1 WHERE id=?").bind('transcript-'+id).run();
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES(?,'openai-diarization-v1',6000000)").bind('transcript-'+id+'-attempt-1').run();
 const module=createTranscriptionModule({...env,OPENAI_API_KEY:undefined,OPENAI_JOBS_CONFIGURED:'true'},adapter(async()=>{throw new Error('Must not call provider');}));await module.run(id);
 expect((await module.status(id,id))?.state).toBe('configuration');
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind('transcript-'+id+'-attempt-1').first()).toEqual({state:'settled',settled_units:0});
});

const retryInput=(id:string)=>({actionId:crypto.randomUUID(),transcriptId:'transcript-'+id,attempt:0});
async function failed(id:string){const env=await setup(id);await db.prepare("UPDATE transcriptions SET state='failed' WHERE id=?").bind('transcript-'+id).run();return env;}
test('concurrent explicit retries reserve once and duplicate actions replay the same dispatch',async()=>{
 const id='retry-concurrent',env=await failed(id),input=retryInput(id);const dispatched:string[]=[];
 const retry=createTranscriptionRetry({...env,OPENAI_API_KEY:undefined,OPENAI_JOBS_CONFIGURED:'true'},async key=>{dispatched.push(key);});
 await Promise.all([retry.retry(id,id,input),retry.retry(id,id,input)]);
 expect(dispatched).toEqual(['recovery-'+input.actionId]);
 expect(await db.prepare('SELECT paid_attempt,state FROM transcriptions WHERE id=?').bind(input.transcriptId).first()).toEqual({paid_attempt:1,state:'queued'});
 expect(await db.prepare('SELECT state,reserved_units FROM processing_budget WHERE id=?').bind(input.transcriptId+'-attempt-1').first()).toEqual({state:'reserved',reserved_units:6000000});
 await expect(retry.retry(id,id,{...input,actionId:crypto.randomUUID()})).rejects.toThrow('Retry is unavailable');
 await expect(retry.retry('someone-else',id,input)).rejects.toThrow('Review not found');
});
test('lost dispatch responses retry one Workflow identity and expire without charging',async()=>{
 const id='retry-dispatch',env=await failed(id),input=retryInput(id);const dispatched:string[]=[];
 const retry=createTranscriptionRetry(env,async key=>{dispatched.push(key);throw new Error('Lost response');});await retry.retry(id,id,input);
 await db.prepare('UPDATE recovery_requests SET dispatch_started_at=0 WHERE id=?').bind(input.actionId).run();await retry.reconcile();
 expect(dispatched).toEqual(['recovery-'+input.actionId,'recovery-'+input.actionId]);
 await db.prepare('UPDATE recovery_requests SET created_at=0 WHERE id=?').bind(input.actionId).run();await retry.reconcile();
 expect(await db.prepare('SELECT state FROM transcriptions WHERE id=?').bind(input.transcriptId).first()).toEqual({state:'failed'});
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(input.transcriptId+'-attempt-1').first()).toEqual({state:'settled',settled_units:0});
 let calls=0;await createTranscriptionModule(env,adapter(async()=>{calls++;return Response.json(provider);})).run(id,1);expect(calls).toBe(0);
});
test('unresolved charges and another active job block explicit retry',async()=>{
 const id='retry-unknown-charge',env=await failed(id),input=retryInput(id),retry=createTranscriptionRetry(env);
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES(?,'openai-diarization-v1',6000000)").bind(input.transcriptId).run();
 await expect(retry.retry(id,id,input)).rejects.toThrow('Retry is unavailable');
 await db.prepare("UPDATE processing_budget SET state='settled',settled_units=0 WHERE id=?").bind(input.transcriptId).run();
 await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,created_at) VALUES('busy',?,?,'busy','running',0)").bind(id,id).run();
 await expect(retry.retry(id,id,input)).rejects.toThrow('Retry is unavailable');
 await db.prepare("UPDATE processing_jobs SET state='failed' WHERE id='busy'").run();await retry.retry(id,id,input);
 expect(await db.prepare('SELECT paid_attempt FROM transcriptions WHERE id=?').bind(input.transcriptId).first()).toEqual({paid_attempt:1});
});

test('deleting a queued retry releases its unsent reservation and prevents dispatch',async()=>{
 const id='retry-deletion',env=await failed(id),input=retryInput(id);await createTranscriptionRetry(env).retry(id,id,input);
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();
 const dispatched:string[]=[];await createTranscriptionRetry(env,async key=>{dispatched.push(key);}).reconcile();
 await createTranscriptionModule(env).cleanup();expect(dispatched).not.toContain('recovery-'+input.actionId);
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(input.transcriptId+'-attempt-1').first()).toEqual({state:'settled',settled_units:0});
 await expect(createTranscriptionRetry(env).retry(id,id,input)).rejects.toThrow('Review not found');
});
test('an old Workflow cannot claim the new attempt and exhausted retries remain blocked',async()=>{
 const id='retry-old-workflow',env=await failed(id),input=retryInput(id);await createTranscriptionRetry(env).retry(id,id,input);
 let calls=0;const module=createTranscriptionModule(env,adapter(async()=>{calls++;return Response.json(provider);}));
 await module.run(id,0);expect(calls).toBe(0);await module.run(id,1);expect(calls).toBe(1);
 await db.prepare("UPDATE transcriptions SET state='failed',paid_attempt=2 WHERE id=?").bind(input.transcriptId).run();
 await expect(createTranscriptionRetry(env).retry(id,id,{...input,actionId:crypto.randomUUID(),attempt:2})).rejects.toThrow('Retry is unavailable');
});
test('the shared allowance check reserves only one concurrent retry when capacity is limited',async()=>{
 const first='retry-budget-a',second='retry-budget-b',a=await failed(first),b=await failed(second);
 // Preserve previous test charges and leave exactly one attempt of capacity.
 const total=await db.prepare("SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) AS used FROM processing_budget").first<{used:number}>();
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units,state,settled_units) VALUES('retry-budget-fixture','fixture',?,'settled',?)").bind(44000000-total!.used,44000000-total!.used).run();
 const outcomes=await Promise.allSettled([createTranscriptionRetry(a).retry(first,first,retryInput(first)),createTranscriptionRetry(b).retry(second,second,retryInput(second))]);
 expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const used=await db.prepare("SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) AS used FROM processing_budget").first<{used:number}>();expect(used?.used).toBe(50000000);
});
