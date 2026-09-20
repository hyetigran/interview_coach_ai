import {createGroupingModule} from '../server/grouping';
import {createRecoveryModule} from '../server/recovery';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpeakerModule } from '../server/speakers';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
let db: D1Database; let bucket: R2Bucket;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database; bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
});
afterAll(() => runtime.dispose());
async function setup(id: string, owner = id) {
  await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'Review','Engineer','mock',0,0)").bind(id,owner).run();
  await db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key) VALUES(?,?,?,?,1,'ready',?)").bind('t-'+id,id,owner,'job-'+id,'document-'+id).run();
  await bucket.put('document-'+id,JSON.stringify({ version: 1, model: 'gpt-4o-transcribe-diarize', audioSha256:'hash', durationMs:3000, utterances: ['A','B','C',null].map((speaker,index) => ({ id:'u'+index,speaker,text:'Speech',startMs:0,endMs:1000,overlap:false })) }));
  return { actionId: crypto.randomUUID(), transcriptId:'t-'+id, speakers:['A','C'] };
}
test('confirmation persists multiple candidate labels before dispatch; lost delivery reuses one workflow identity', async () => {
  const input = await setup('speaker-success'); const calls: string[] = [];
  const module = createSpeakerModule({ DB:db,MEDIA:bucket },async id => { expect((await module.status('speaker-success','speaker-success'))?.speakers).toEqual(['A','C']); calls.push(id); if(calls.length===1) throw new Error('Lost response'); });
  await module.confirm('speaker-success','speaker-success',input); await module.reconcile();
  expect(calls).toHaveLength(1);
  await db.prepare('UPDATE speaker_confirmations SET dispatch_started_at=0 WHERE id=?').bind(input.actionId).run();await module.reconcile();
  expect(new Set(calls).size).toBe(1); expect(calls).toHaveLength(2);
  const first = await module.resume(input.actionId); expect(first?.speakers).toEqual(['A','C']);
  expect(await module.resume(input.actionId)).toEqual(first);
  expect((await module.status('speaker-success','speaker-success'))?.state).toBe('confirmed');
  expect(await module.status('other','speaker-success')).toBeNull();
  expect((await db.prepare('SELECT COUNT(*) AS count FROM processing_budget').first<{count:number}>())?.count).toBe(0);
});
test('invalid labels, stale versions and deleted reviews cannot authorize continuation', async () => {
  const input = await setup('speaker-invalid'); const module = createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
  await expect(module.confirm('speaker-invalid','speaker-invalid',{...input,speakers:['invented']})).rejects.toThrow();
  await expect(module.confirm('other','speaker-invalid',input)).rejects.toThrow();
  await expect(module.confirm('speaker-invalid','speaker-invalid',{...input,transcriptId:'old'})).rejects.toThrow();
  await module.confirm('speaker-invalid','speaker-invalid',input);
  await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id='speaker-invalid'").run();
  expect(await module.resume(input.actionId)).toBeNull(); await module.reconcile();
  expect(await db.prepare('SELECT state,speakers FROM speaker_confirmations WHERE id=?').bind(input.actionId).first()).toEqual({state:'cancelled',speakers:'[]'});
});
test('waiting releases the account slot; confirmation waits behind active automatic work', async () => {
  const input = await setup('speaker-wait','busy-owner'); let calls = 0;
  await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,created_at,deadline) VALUES('busy-job','speaker-wait','busy-owner','busy-upload','running',0,9999999999999)").run();
  const module = createSpeakerModule({DB:db,MEDIA:bucket},async()=>{calls++;});
  await module.confirm('busy-owner','speaker-wait',input); expect(calls).toBe(0); expect((await module.status('busy-owner','speaker-wait'))?.state).toBe('queued');
  await db.prepare("UPDATE processing_jobs SET state='ready' WHERE id='busy-job'").run(); await module.reconcile(); expect(calls).toBe(1);
  await db.prepare("UPDATE reviews SET input_revision=2 WHERE id='speaker-wait'").run(); expect(await module.resume(input.actionId)).toBeNull();
});
test('duplicate confirmations cannot change attribution or create another continuation', async () => {
  const input = await setup('speaker-duplicate'); const module = createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
  await Promise.all([module.confirm('speaker-duplicate','speaker-duplicate',input),module.confirm('speaker-duplicate','speaker-duplicate',input)]);
  await expect(module.confirm('speaker-duplicate','speaker-duplicate',{...input,speakers:['B']})).rejects.toThrow();
  expect((await db.prepare("SELECT COUNT(*) AS count FROM speaker_confirmations WHERE review_id='speaker-duplicate'").first<{count:number}>())?.count).toBe(1);
});
test('a newer ready transcript can receive its own confirmation after invalidation', async () => {
  const input = await setup('speaker-replacement'); const module = createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
  await module.confirm('speaker-replacement','speaker-replacement',input);
  await db.prepare("UPDATE reviews SET input_revision=2 WHERE id='speaker-replacement'").run(); await module.reconcile();
  await db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key) VALUES('replacement-t','speaker-replacement','speaker-replacement','replacement-job',2,'ready','document-speaker-replacement')").run();
  const current = await module.confirm('speaker-replacement','speaker-replacement',{ actionId:crypto.randomUUID(),transcriptId:'replacement-t',speakers:['B'] });
  expect(current?.speakers).toEqual(['B']); expect(await module.resume(input.actionId)).toBeNull();
});
test('invalidation immediately before the atomic resume cannot return attribution', async () => {
  const input = await setup('speaker-race'); const module = createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
  await module.confirm('speaker-race','speaker-race',input);
  const invalidating = new Proxy(db,{ get(target,property) {
    if(property==='prepare') return (sql:string) => {
      const statement = target.prepare(sql);
      if(!sql.startsWith("UPDATE speaker_confirmations SET state='confirmed'")) return statement;
      return { bind: (...values: unknown[]) => { const bound = statement.bind(...values); return { first: async () => { await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id='speaker-race'").run(); return bound.first(); } }; } };
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  expect(await createSpeakerModule({DB:invalidating,MEDIA:bucket}).resume(input.actionId)).toBeNull();
});

test('expired confirmation retries retain transcription and replay one persisted action',async()=>{
 const review='speaker-retry',input=await setup(review),sent:string[]=[],speakers=createSpeakerModule({DB:db,MEDIA:bucket},async id=>{sent.push(id);});await speakers.confirm(review,review,input);await db.prepare('UPDATE speaker_confirmations SET deadline=0 WHERE id=?').bind(input.actionId).run();await speakers.reconcile();expect((await speakers.status(review,review))?.state).toBe('failed');
 const recovery=createRecoveryModule({DB:db,MEDIA:bucket}),action={actionId:crypto.randomUUID(),targetId:input.actionId};await expect(recovery.retryConfirmation('other',review,action)).rejects.toThrow('Review not found');
 await Promise.all([recovery.retryConfirmation(review,review,action),recovery.retryConfirmation(review,review,action)]);await speakers.reconcile();expect(sent).toEqual([input.actionId,action.actionId]);expect(await speakers.resume(input.actionId)).toBeNull();expect(await speakers.resume(action.actionId)).toMatchObject({transcriptId:input.transcriptId});
 expect(await db.prepare('SELECT COUNT(*) AS count FROM transcriptions WHERE review_id=?').bind(review).first()).toEqual({count:1});expect(await db.prepare('SELECT retry_attempts FROM speaker_confirmations WHERE id=?').bind(action.actionId).first()).toEqual({retry_attempts:2});
 await recovery.retryConfirmation(review,review,action);expect(sent).toHaveLength(2);
});
test('confirmation retry is bounded and revoked by deletion',async()=>{
 const review='speaker-retry-bound',input=await setup(review),speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});await speakers.confirm(review,review,input);await db.prepare("UPDATE speaker_confirmations SET state='failed',retry_attempts=3 WHERE id=?").bind(input.actionId).run();const recovery=createRecoveryModule({DB:db,MEDIA:bucket});await expect(recovery.retryConfirmation(review,review,{actionId:crypto.randomUUID(),targetId:input.actionId})).rejects.toThrow('three-attempt limit');
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(review).run();await expect(recovery.retryConfirmation(review,review,{actionId:crypto.randomUUID(),targetId:input.actionId})).rejects.toThrow('Review not found');
});

test('confirmation can retry an expired, unsubmitted grouping intent without reviving its workflow',async()=>{
 const review='speaker-grouping-expiry',input=await setup(review),speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
 await speakers.confirm(review,review,input);
 const grouping=createGroupingModule({DB:db,MEDIA:bucket});
 expect(await grouping.begin(input.actionId)).toBeGreaterThan(0);
 await db.prepare('UPDATE speaker_confirmations SET deadline=0 WHERE id=?').bind(input.actionId).run();await speakers.reconcile();
 expect((await speakers.status(review,review))?.canRetry).toBe(true);
 const action={actionId:crypto.randomUUID(),targetId:input.actionId};
 await createRecoveryModule({DB:db,MEDIA:bucket}).retryConfirmation(review,review,action);
 await speakers.reconcile();
 expect(await speakers.resume(input.actionId)).toBeNull();
 expect(await grouping.begin(input.actionId)).toBe(0);
 expect(await grouping.begin(action.actionId)).toBeGreaterThan(0);
 expect(await speakers.resume(action.actionId)).toMatchObject({transcriptId:input.transcriptId});
 expect(await db.prepare('SELECT state FROM grouping_runs WHERE id=?').bind(input.actionId).first()).toEqual({state:'outdated'});
});
test.each(['result','submission','reservation'])('confirmation retry retains grouping with %s evidence',async evidence=>{
 const review='speaker-grouping-'+evidence,input=await setup(review),speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
 await speakers.confirm(review,review,input);await createGroupingModule({DB:db,MEDIA:bucket}).begin(input.actionId);
 if(evidence==='result')await db.prepare("UPDATE grouping_chunks SET result='[]',state='ready' WHERE run_id=?").bind(input.actionId).run();
 if(evidence==='submission')await db.prepare('UPDATE grouping_chunks SET submitted=1 WHERE run_id=?').bind(input.actionId).run();
 if(evidence==='reservation')await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units,state) VALUES(?,'openai-grouping-v1',450000,'reserved')").bind('group-'+input.actionId+'-0').run();
 await db.prepare('UPDATE speaker_confirmations SET deadline=0 WHERE id=?').bind(input.actionId).run();await speakers.reconcile();
 expect((await speakers.status(review,review))?.canRetry).toBe(false);
 await expect(createRecoveryModule({DB:db,MEDIA:bucket}).retryConfirmation(review,review,{actionId:crypto.randomUUID(),targetId:input.actionId})).rejects.toThrow('Existing analysis');
 expect(await db.prepare('SELECT id FROM grouping_runs WHERE id=?').bind(input.actionId).first()).not.toBeNull();
});

test('lost confirmation dispatch stops after three attempts and explicit retry gets a fresh dispatch allowance',async()=>{
 const review='speaker-dispatch-bound',input=await setup(review);let calls=0;
 const speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{calls++;throw new Error('Lost dispatch');});
 await speakers.confirm(review,review,input);
 for(let i=0;i<5;i++){await db.prepare('UPDATE speaker_confirmations SET dispatch_started_at=0 WHERE id=?').bind(input.actionId).run();await speakers.reconcile();}
 expect(calls).toBe(3);
 await db.prepare('UPDATE speaker_confirmations SET deadline=0 WHERE id=?').bind(input.actionId).run();await speakers.reconcile();
 const action={actionId:crypto.randomUUID(),targetId:input.actionId};
 await createRecoveryModule({DB:db,MEDIA:bucket}).retryConfirmation(review,review,action);await speakers.reconcile();
 expect(calls).toBe(4);
 expect(await db.prepare('SELECT dispatch_attempts FROM speaker_confirmations WHERE id=?').bind(action.actionId).first()).toEqual({dispatch_attempts:1});
});

test('completed hosted compression retains its cost reservation and allows speaker continuation',async()=>{
  const id='hosted-speakers';
  const input=await setup(id);
  const bill='media-compression-'+input.transcriptId;
  await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units,media_completed_at) VALUES(?,'cloudflare-media-v1',100000,?)").bind(bill,Date.now()).run();
  const calls:string[]=[];
  const module=createSpeakerModule({DB:db,MEDIA:bucket},async id=>{calls.push(id);});
  await module.confirm(id,id,input);
  await module.reconcile();
  expect(calls).toEqual([input.actionId]);
  expect((await module.resume(input.actionId))?.speakers).toEqual(['A','C']);
  expect(await db.prepare('SELECT state,reserved_units,settled_units FROM processing_budget WHERE id=?').bind(bill).first()).toEqual({state:'reserved',reserved_units:100000,settled_units:null});
});

test('part-scoped maximum provider labels persist through speaker confirmation',async()=>{
 const review='speaker-part-label',input=await setup(review);
 const speaker='Part 3 / '+'x'.repeat(100);
 await bucket.put('document-'+review,JSON.stringify({version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:3000,utterances:[{id:'u',speaker,text:'My answer.',startMs:0,endMs:1000,overlap:false,boundaryUncertain:true}]}));
 const module=createSpeakerModule({DB:db,MEDIA:bucket});
 await module.confirm(review,review,{...input,speakers:[speaker]});
 expect((await module.status(review,review))?.speakers).toEqual([speaker]);
});
