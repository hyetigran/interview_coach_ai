import {createGroupingRetry} from '../server/grouping-retry';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpeakerModule } from '../server/speakers';
import { createGroupingModule, GROUPING_RESERVATION } from '../server/grouping';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
let db: D1Database; let bucket: R2Bucket;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database; bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
});
afterAll(() => runtime.dispose());
async function setup(id:string, count=4) {
  await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'Review','Engineer','mock',0,0)").bind(id,id).run();
  await db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key) VALUES(?,?,?,?,1,'ready',?)").bind('t-'+id,id,id,'job-'+id,'document-'+id).run();
  const utterances=Array.from({length:count},(_,i)=>({id:'u'+i,speaker:i%2?'B':'A',text:i%2?'I led the rollout with two engineers.':'Tell me about a project you led.',startMs:i*1000,endMs:(i+1)*1000,overlap:false}));
  await bucket.put('document-'+id,JSON.stringify({version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:count*1000,utterances}));
  const actionId=crypto.randomUUID();const speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
  await speakers.confirm(id,id,{actionId,transcriptId:'t-'+id,speakers:['B']});return {actionId,speakers};
}
const valid = {groups:[{question:[{utteranceId:'u0',quote:'Tell me about a project you led.'}],answers:[{utteranceId:'u1',quote:'I led the rollout with two engineers.'}],parent:null,uncertain:false}]};
function response(data:unknown=valid) { return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100,input_tokens_details:{cached_tokens:0}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]}); }
test('durable grouping uses confirmed roles, settles shared budget, survives reload and isolates owners',async()=>{
  const {actionId,speakers}=await setup('group-valid');let calls=0;
  const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{
    calls++;const body=JSON.parse(init!.body as string);expect(body.store).toBe(false);expect(body.max_output_tokens).toBe(8192);expect(JSON.parse(body.input).candidateSpeakers).toEqual(['B']);expect(body.input).not.toContain('resume');return response();
  });
  expect(await module.begin(actionId)).toBe(1);await speakers.resume(actionId);
  await Promise.all([module.runChunk(actionId,0),module.runChunk(actionId,0)]);await module.finish(actionId);
  expect(calls).toBe(1);expect((await module.status('group-valid','group-valid'))?.groups).toHaveLength(1);
  expect((await module.status('group-valid','group-valid'))?.state).toBe('ready');expect(await module.status('other','group-valid')).toBeNull();
  expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(`group-${actionId}-0`).first()).toEqual({state:'settled',settled_units:200});
});
test('unknown paid outcome is never resubmitted, but later valid chunks remain accessible',async()=>{
  const {actionId,speakers}=await setup('group-partial',48);let calls=0;
  const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;if(calls===1)throw new Error('Lost response');return response({groups:[{...valid.groups[0],question:[{utteranceId:'u24',quote:valid.groups[0].question[0].quote}],answers:[]}]});});
  expect(await module.begin(actionId)).toBe(2);await speakers.resume(actionId);await module.runChunk(actionId,0);await module.runChunk(actionId,0);await module.runChunk(actionId,1);await module.finish(actionId);
  expect(calls).toBe(2);const status=await module.status('group-partial','group-partial');expect(status?.state).toBe('partial');expect(status?.groups).toHaveLength(1);expect(status?.errors).toHaveLength(1);
  expect(await db.prepare('SELECT state,reserved_units FROM processing_budget WHERE id=?').bind(`group-${actionId}-0`).first()).toEqual({state:'reserved',reserved_units:GROUPING_RESERVATION});
});
test('malformed evidence fails only its section and deletion removes private receipts and grouping',async()=>{
  const {actionId,speakers}=await setup('group-invalid');const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>response({groups:[{...valid.groups[0],answers:[{utteranceId:'fake',quote:'invented'}]}]}));
  await module.begin(actionId);await speakers.resume(actionId);await module.runChunk(actionId,0);await module.finish(actionId);
  expect((await module.status('group-invalid','group-invalid'))?.state).toBe('partial');
  await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id='group-invalid'").run();await module.cleanup();expect(await module.status('group-invalid','group-invalid')).toBeNull();
  expect(await bucket.get(`grouping/group-invalid/group-${actionId}-0.provider.json`)).toBeNull();
});
test('deletion during provider response prevents late publication or retained transcript receipts',async()=>{
  const {actionId,speakers}=await setup('group-race');const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id='group-race'").run();await module.cleanup();return response();});
  await module.begin(actionId);await speakers.resume(actionId);await module.runChunk(actionId,0);expect(await module.status('group-race','group-race')).toBeNull();expect(await bucket.get(`grouping/group-race/group-${actionId}-0.provider.json`)).toBeNull();
  expect(await db.prepare('SELECT state,result FROM grouping_chunks WHERE id=?').bind(`group-${actionId}-0`).first()).toEqual({state:'cancelled',result:null});
});
test('restarting intent creation fills missing sections without replacing completed work',async()=>{
  const {actionId}=await setup('group-intent',48);const module=createGroupingModule({DB:db,MEDIA:bucket});await module.begin(actionId);await db.prepare('DELETE FROM grouping_chunks WHERE run_id=? AND ordinal=1').bind(actionId).run();expect(await module.begin(actionId)).toBe(2);expect((await db.prepare('SELECT COUNT(*) AS n FROM grouping_chunks WHERE run_id=?').bind(actionId).first<{n:number}>())?.n).toBe(2);
});
test.skipIf(process.env.OPENAI_GROUPING_SMOKE!=='1')('real OpenAI structured grouping accepts the schema and publishes grounded evidence',async()=>{
  const {parseEnv}=await import('node:util');const {writeFileSync}=await import('node:fs');
  const key=parseEnv(readFileSync('.env','utf8')).OPENAI_API_KEY;expect(Boolean(key)).toBe(true);
  const {actionId,speakers}=await setup('group-live',2);const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:key});await module.begin(actionId);await speakers.resume(actionId);
  try {await module.runChunk(actionId,0);await module.finish(actionId);const status=await module.status('group-live','group-live');expect(status?.state).toBe('ready');expect(status?.groups.length).toBeGreaterThan(0);}
  finally {const rows=(await db.prepare('SELECT * FROM processing_budget WHERE id=?').bind(`group-${actionId}-0`).all()).results;writeFileSync(`/tmp/interviewcoach-grouping-cost-${actionId}.json`,JSON.stringify(rows),{mode:0o600});}
},120000);
test('a Workflow-level timeout does not stop later sections or retain the account slot',async()=>{
  const {runGroupingSections}=await import('../server/grouping-steps');
  const {actionId,speakers}=await setup('group-step-timeout',48);const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>response({groups:[]}));await module.begin(actionId);await speakers.resume(actionId);
  const step={do:async(name:string,...args:unknown[])=>{if(name==='group-section-0')throw new Error('Workflow runtime timeout');return await (args.at(-1) as ()=>Promise<unknown>)();}};
  await runGroupingSections(step as Parameters<typeof runGroupingSections>[0],module,actionId,2);
  const result=await module.status('group-step-timeout','group-step-timeout');expect(result?.state).toBe('partial');expect(result?.completed).toBe(1);expect(result?.errors).toHaveLength(1);
});
test('a parent reference outside supplied window and prior groups is rejected',async()=>{
  const {actionId,speakers}=await setup('group-parent-provenance',48);const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>response({groups:[{question:[{utteranceId:'u24',quote:valid.groups[0].question[0].quote}],answers:[],parent:valid.groups[0].question[0],uncertain:false}]}));await module.begin(actionId);await speakers.resume(actionId);await module.interruptChunk(actionId,0);await module.runChunk(actionId,1);await module.finish(actionId);expect((await module.status('group-parent-provenance','group-parent-provenance'))?.groups).toHaveLength(0);
});
test('candidate-only speech never becomes an interviewer question or triggers a paid grouping call',async()=>{
  const {actionId,speakers}=await setup('group-candidate-only',2);
  await db.prepare("UPDATE speaker_confirmations SET speakers='[\"A\",\"B\"]' WHERE id=?").bind(actionId).run();
  let calls=0;const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response();});await module.begin(actionId);await speakers.resume(actionId);await module.runChunk(actionId,0);await module.finish(actionId);
  expect(calls).toBe(0);expect((await module.status('group-candidate-only','group-candidate-only'))?.groups).toEqual([]);expect((await module.status('group-candidate-only','group-candidate-only'))?.state).toBe('ready');
});
test('candidate-only windows still attach a long answer to a supplied prior question',async()=>{
  const {actionId,speakers}=await setup('group-long-answer',48);
  const object=await bucket.get('document-group-long-answer');const doc=await object!.json<{utterances:{speaker:string;text:string}[]}>();doc.utterances.forEach((u,i)=>{if(i){u.speaker='B';u.text='I led the rollout with two engineers.';}});await bucket.put('document-group-long-answer',JSON.stringify(doc));
  let calls=0;const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response({groups:[{...valid.groups[0],answers:[{utteranceId:calls===1?'u1':'u30',quote:valid.groups[0].answers[0].quote}]}]});});
  await module.begin(actionId);await speakers.resume(actionId);await module.runChunk(actionId,0);await module.runChunk(actionId,1);await module.finish(actionId);
  expect(calls).toBe(2);const status=await module.status('group-long-answer','group-long-answer');expect(status?.state).toBe('ready');expect(status?.groups).toHaveLength(1);expect(status?.groups[0].answers.map(a=>a.utteranceId)).toEqual(['u1','u30']);
});
test('saved grouping survives a failed database publication without another provider submission',async()=>{
 const review='group-receipt',{actionId,speakers}=await setup(review);let fail=true,calls=0;
 const failingDB=new Proxy(db,{get(target,property){if(property==='prepare')return(sql:string)=>{const statement=target.prepare(sql);if(!sql.startsWith("UPDATE grouping_chunks SET state='ready',result=?"))return statement;return{bind:(...values:unknown[])=>{const bound=statement.bind(...values);return{run:async()=>{if(fail){fail=false;throw new Error('Database publication failed');}return bound.run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
 const module=createGroupingModule({DB:failingDB,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response();});await module.begin(actionId);await speakers.resume(actionId);await module.runChunk(actionId,0);await module.finish(actionId);expect((await module.status(review,review))?.state).toBe('partial');
 await Promise.all([module.recoverReceipt(actionId,0),module.recoverReceipt(actionId,0)]);expect(calls).toBe(1);expect((await module.status(review,review))?.state).toBe('ready');expect((await module.status(review,review))?.groups).toHaveLength(1);expect(await db.prepare('SELECT publication_attempts FROM grouping_chunks WHERE run_id=?').bind(actionId).first()).toEqual({publication_attempts:1});
});
test('grouping receipt recovery refuses changed prior evidence and deleted reviews',async()=>{
 const review='group-receipt-context',{actionId,speakers}=await setup(review,48);let calls=0;const module=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response({groups:[]});});await module.begin(actionId);await speakers.resume(actionId);await module.runChunk(actionId,0);await module.runChunk(actionId,1);await module.finish(actionId);
 const source=(await module.status(review,review))!;expect(source.groups).toEqual([]);
 await db.prepare("UPDATE grouping_chunks SET state='failed',result=NULL WHERE run_id=? AND ordinal=1").bind(actionId).run();
 const transcript:import('../lib/transcript').Transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:48000,utterances:Array.from({length:48},(_,i)=>({id:'u'+i,speaker:i%2?'B':'A',text:i%2?'I led the rollout with two engineers.':'Tell me about a project you led.',startMs:i*1000,endMs:(i+1)*1000,overlap:false}))};
 const {resolveGroups}=await import('../lib/threads');await db.prepare("UPDATE grouping_chunks SET result=? WHERE run_id=? AND ordinal=0").bind(JSON.stringify(resolveGroups(valid,transcript,'t-'+review,['B'])),actionId).run();
 await module.recoverReceipt(actionId,1);expect(calls).toBe(2);expect(await db.prepare('SELECT state,result FROM grouping_chunks WHERE run_id=? AND ordinal=1').bind(actionId).first()).toEqual({state:'reconciliation',result:null});
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(review).run();await module.recoverReceipt(actionId,1);await module.cleanup();expect(await bucket.head(`grouping/${review}/group-${actionId}-1.provider.json`)).toBeNull();
});

test('explicit grouping retry reserves the suffix once and reuses an unchanged completed section',async()=>{
 const review='group-retry-reuse',{actionId,speakers}=await setup(review,48),env={DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'};let calls=0;
 const grouping=createGroupingModule(env,async()=>{calls++;return calls===1?new Response('Quota',{status:429}):response({groups:[]});});
 await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);await grouping.runChunk(actionId,1);await grouping.finish(actionId);expect(calls).toBe(2);
 const sent:string[]=[],retry=createGroupingRetry(env,async id=>{sent.push(id);}),plan=(await retry.plan(review,review))!;
 expect(plan.canRetry).toBe(true);expect(plan.sections).toEqual([1,2]);
 const input={actionId:crypto.randomUUID(),runId:actionId,version:plan.version};await Promise.all([retry.retry(review,review,input),retry.retry(review,review,input)]);
 expect(sent).toEqual([input.actionId]);
 const work=(await retry.work(input.actionId))!;for(const step of work.steps)await grouping.runChunk(work.runId,step.ordinal,step.attempt);await grouping.finish(actionId);
 expect(calls).toBe(3);expect((await grouping.status(review,review))?.state).toBe('ready');
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(`group-${actionId}-1-attempt-1`).first()).toEqual({state:'settled',settled_units:0});
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(`group-${actionId}-0-attempt-1`).first()).toEqual({settled_units:200});
 await retry.retry(review,review,input);expect(sent).toHaveLength(1);
});
test('retrying earlier grouping reprocesses a later section when its prior questions change',async()=>{
 const review='group-retry-dependent',{actionId,speakers}=await setup(review,48),env={DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'};let calls=0;
 const grouping=createGroupingModule(env,async()=>{calls++;return calls===1?new Response('Quota',{status:429}):calls===3?response():response({groups:[]});});
 await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);await grouping.runChunk(actionId,1);await grouping.finish(actionId);
 const retry=createGroupingRetry(env),plan=(await retry.plan(review,review))!,input={actionId:crypto.randomUUID(),runId:actionId,version:plan.version};await retry.retry(review,review,input);
 await grouping.runChunk(actionId,0,0);expect(calls).toBe(2);
 const work=(await retry.work(input.actionId))!;for(const step of work.steps)await grouping.runChunk(work.runId,step.ordinal,step.attempt);await grouping.finish(actionId);expect(calls).toBe(4);
 expect((await grouping.status(review,review))?.groups).toHaveLength(1);
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(`group-${actionId}-1-attempt-1`).first()).toEqual({settled_units:200});
});
test('unknown grouping outcome blocks retry and deleted queued retries release their reservations',async()=>{
 const review='group-retry-unknown',{actionId,speakers}=await setup(review),env={DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'};
 const grouping=createGroupingModule(env,async()=>{throw new Error('Lost response');});await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);await grouping.finish(actionId);
 const retry=createGroupingRetry(env),plan=(await retry.plan(review,review))!;expect(plan.canRetry).toBe(false);
 await expect(retry.retry(review,review,{actionId:crypto.randomUUID(),runId:actionId,version:plan.version})).rejects.toThrow('reconciliation');
 const other='group-retry-deleted',fixture=await setup(other),otherGrouping=createGroupingModule(env,async()=>new Response('Quota',{status:429}));await otherGrouping.begin(fixture.actionId);await fixture.speakers.resume(fixture.actionId);await otherGrouping.runChunk(fixture.actionId,0);await otherGrouping.finish(fixture.actionId);
 const p=(await retry.plan(other,other))!,input={actionId:crypto.randomUUID(),runId:fixture.actionId,version:p.version};await retry.retry(other,other,input);
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(other).run();await retry.reconcile();expect(await retry.work(input.actionId)).toBeNull();
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(`group-${fixture.actionId}-0-attempt-1`).first()).toEqual({state:'settled',settled_units:0});
 await expect(retry.retry(other,other,input)).rejects.toThrow('Review not found');
});

test('lost grouping retry dispatch reuses its identity and releases expired unsent reservations',async()=>{
 const review='group-retry-dispatch',{actionId,speakers}=await setup(review),env={DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'};
 const grouping=createGroupingModule(env,async()=>new Response('Quota',{status:429}));await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);await grouping.finish(actionId);
 const sent:string[]=[],retry=createGroupingRetry(env,async id=>{sent.push(id);throw new Error('Lost response');}),plan=(await retry.plan(review,review))!,input={actionId:crypto.randomUUID(),runId:actionId,version:plan.version};await retry.retry(review,review,input);
 for(let i=0;i<5;i++){await db.prepare('UPDATE recovery_requests SET dispatch_started_at=0 WHERE id=?').bind(input.actionId).run();await retry.reconcile();}
 expect(sent.filter(id=>id===input.actionId)).toEqual([input.actionId,input.actionId,input.actionId]);
 await db.prepare('UPDATE recovery_requests SET created_at=0 WHERE id=?').bind(input.actionId).run();await retry.reconcile();expect(await retry.work(input.actionId)).toBeNull();
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(`group-${actionId}-0-attempt-1`).first()).toEqual({state:'settled',settled_units:0});
 expect((await grouping.status(review,review))?.state).toBe('partial');
});
test('saved receipt input allows reuse of completed sections from before retry metadata existed',async()=>{
 const review='group-retry-legacy',{actionId,speakers}=await setup(review,48),env={DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'};let calls=0;
 const grouping=createGroupingModule(env,async()=>{calls++;return calls===1?new Response('Quota',{status:429}):response({groups:[]});});await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);await grouping.runChunk(actionId,1);await grouping.finish(actionId);
 await db.prepare('UPDATE grouping_chunks SET input_payload=NULL WHERE run_id=? AND ordinal=1').bind(actionId).run();
 const retry=createGroupingRetry(env),plan=(await retry.plan(review,review))!,input={actionId:crypto.randomUUID(),runId:actionId,version:plan.version};await retry.retry(review,review,input);
 const work=(await retry.work(input.actionId))!;for(const step of work.steps)await grouping.runChunk(work.runId,step.ordinal,step.attempt);await grouping.finish(actionId);expect(calls).toBe(3);
});
