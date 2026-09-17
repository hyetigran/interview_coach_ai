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
