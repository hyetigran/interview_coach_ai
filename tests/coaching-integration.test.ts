import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpeakerModule } from '../server/speakers';
import { createGroupingModule } from '../server/grouping';
import { createCoachingModule } from '../server/coaching';
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: ['DB'], r2Buckets: ['MEDIA'] }));
let db: D1Database; let bucket: R2Bucket;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database; bucket = await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) for (const statement of readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement).run();
});
afterAll(() => runtime.dispose());
async function setup(id:string, count=2) {
  await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'Review','Engineer','mock',0,0)").bind(id,id).run();
  await db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key) VALUES(?,?,?,?,1,'ready',?)").bind('t-'+id,id,id,'job-'+id,'document-'+id).run();
  const utterances=Array.from({length:count},(_,i)=>({id:'u'+i,speaker:i%2?'B':'A',text:i%2?'I led the rollout with two engineers.':'Tell me about a project you led.',startMs:i*1000,endMs:(i+1)*1000,overlap:false}));
  await bucket.put('document-'+id,JSON.stringify({version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:count*1000,utterances}));
  const actionId=crypto.randomUUID();const speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});
  await speakers.confirm(id,id,{actionId,transcriptId:'t-'+id,speakers:['B']});return {actionId,speakers};
}
const valid = {groups:[{question:[{utteranceId:'u0',quote:'Tell me about a project you led.'}],answers:[{utteranceId:'u1',quote:'I led the rollout with two engineers.'}],parent:null,uncertain:false}]};
function response(data:unknown=valid) { return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100,input_tokens_details:{cached_tokens:0}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]}); }
async function ready(id:string) {
 const {actionId,speakers}=await setup(id);const grouping=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>response());await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);await grouping.finish(actionId);return actionId;
}
function coachResponse(input:RequestInit|undefined) {
 const body=JSON.parse(input!.body as string);const payload=JSON.parse(body.input);
 if(payload.draft)return response({supported:true,issues:[]});
 const source=payload.sources.answers[0];
 return response({outcome:'preserve',questionType:'past_project',rationale:'Keep your clear ownership and team detail.',dimensions:['ownership','specificity'],segments:[{kind:'assertion',text:source.quote,citations:[{sourceId:source.sourceId,quote:source.quote}]}],missingFacts:[],limitations:[]});
}
test('publishes structurally resolved advice only after support verification; replay and ownership are safe',async()=>{
 const action=await ready('coach-success');let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{calls++;return coachResponse(init);});const [job]=await module.begin(action);
 await Promise.all([module.run(job),module.run(job)]);await module.finish(action);await module.run(job);
 const result=await module.status('coach-success','coach-success');expect(result?.state).toBe('ready');expect(result?.jobs[0].result?.outcome).toBe('preserve');expect(result?.jobs[0].result?.segments[0].citations[0].transcriptId).toBe('t-coach-success');expect(calls).toBe(2);expect(await module.status('other','coach-success')).toBeNull();
});
test('an unsupported assertion fails verification and is withheld instead of repaired automatically',async()=>{
 const action=await ready('coach-unsupported');let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{calls++;return calls===2?response({supported:false,issues:['Unsupported ownership.']}):coachResponse(init);});const [job]=await module.begin(action);await module.run(job);await module.finish(action);
 const result=await module.status('coach-unsupported','coach-unsupported');expect(result?.state).toBe('partial');expect(result?.jobs[0].state).toBe('withheld');expect(result?.jobs[0].result).toBeNull();expect(calls).toBe(2);
});
test('an invalid citation is rejected before a second paid call',async()=>{
 const action=await ready('coach-invalid');let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response({outcome:'improve',questionType:'past_project',rationale:'Explain impact.',dimensions:['specificity'],segments:[{kind:'assertion',text:'I doubled revenue.',citations:[]}],missingFacts:[],limitations:[]});});const [job]=await module.begin(action);await module.run(job);await module.finish(action);
 expect(calls).toBe(1);expect((await module.status('coach-invalid','coach-invalid'))?.jobs[0].result).toBeNull();expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(job+'-verify').first()).toEqual({settled_units:0});
});
test('budget exhaustion stops before the first request and releases unused reservations',async()=>{
 const action=await ready('coach-budget');const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{throw new Error('Must not submit');});const [job]=await module.begin(action);
 const used=await db.prepare("SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE settled_units END) AS n FROM processing_budget").first<{n:number}>();
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES('fill-budget','test',?)").bind(50000000-(used?.n??0)).run();
 await module.run(job);expect((await module.status('coach-budget','coach-budget'))?.jobs[0].state).toBe('failed');await db.prepare("DELETE FROM processing_budget WHERE id='fill-budget'").run();
});
test('unknown paid outcomes are not resubmitted and unused verification cost is released',async()=>{
 const action=await ready('coach-unknown');let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;throw new Error('Connection lost');});const [job]=await module.begin(action);await module.run(job);await module.run(job);expect(calls).toBe(1);expect((await module.status('coach-unknown','coach-unknown'))?.jobs[0].state).toBe('unknown');
 expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(job+'-draft').first()).toEqual({state:'reserved'});expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(job+'-verify').first()).toEqual({settled_units:0});
});
test('a changed source version during verification prevents publication and marks results outdated',async()=>{
 const action=await ready('coach-version');let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{calls++;if(calls===2)await db.prepare("UPDATE reviews SET input_revision=2 WHERE id='coach-version'").run();return coachResponse(init);});const [job]=await module.begin(action);await module.run(job);await module.cleanup();expect((await module.status('coach-version','coach-version'))?.state).toBe('outdated');expect(await db.prepare('SELECT state,result,draft FROM coaching_jobs WHERE id=?').bind(job).first()).toEqual({state:'outdated',result:null,draft:null});
});
test('deletion during generation removes receipts and cannot restore advice',async()=>{
 const action=await ready('coach-delete');const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id='coach-delete'").run();await module.cleanup();return coachResponse(init);});const [job]=await module.begin(action);await module.run(job);expect(await module.status('coach-delete','coach-delete')).toBeNull();expect(await bucket.get(`coaching/coach-delete/${job}-draft.provider.json`)).toBeNull();
});
test.skipIf(process.env.OPENAI_COACHING_SMOKE!=='1')('real OpenAI draft and support check publish a supported synthetic answer',async()=>{
 const {parseEnv}=await import('node:util');const {writeFileSync}=await import('node:fs');const key=parseEnv(readFileSync('.env','utf8')).OPENAI_API_KEY;expect(Boolean(key)).toBe(true);
 const action=await ready('coach-live');const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:key});const [job]=await module.begin(action);
 try {await module.run(job);await module.finish(action);const result=await module.status('coach-live','coach-live');expect(result?.state).toBe('ready');expect(result?.jobs[0].result).not.toBeNull();}
 finally {const rows=(await db.prepare('SELECT * FROM processing_budget WHERE id IN (?,?)').bind(job+'-draft',job+'-verify').all()).results;writeFileSync(`/tmp/interviewcoach-coaching-cost-${action}.json`,JSON.stringify(rows),{mode:0o600});}
},240000);
test('abrupt draft interruption retains only potentially dispatched cost and releases the never-submitted check',async()=>{
 const action=await ready('coach-crash');const module=createCoachingModule({DB:db,MEDIA:bucket});const [job]=await module.begin(action);
 await db.prepare("UPDATE coaching_jobs SET state='generating',draft_dispatched=1 WHERE id=?").bind(job).run();
 for(const stage of ['draft','verify'])await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES(?,'openai-coaching-v1',450000)").bind(job+'-'+stage).run();
 await module.interrupt(job);expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(job+'-draft').first()).toEqual({state:'reserved'});expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(job+'-verify').first()).toEqual({state:'settled',settled_units:0});
});
test('a missing grouping section withholds judgments for its thread while a separately bounded thread continues',async()=>{
 const {actionId,speakers}=await setup('coach-missing-followup',72);let groups=0;
 const grouping=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{const n=groups++;if(n===1)throw new Error('Lost follow-up section');return response({groups:[{...valid.groups[0],question:[{utteranceId:n===0?'u0':'u48',quote:valid.groups[0].question[0].quote}],answers:[{utteranceId:n===0?'u1':'u49',quote:valid.groups[0].answers[0].quote}]}]});});
 await grouping.begin(actionId);await speakers.resume(actionId);for(let n=0;n<3;n++)await grouping.runChunk(actionId,n);await grouping.finish(actionId);
 let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{calls++;return coachResponse(init);});const jobs=await module.begin(actionId);for(const job of jobs)await module.run(job);await module.finish(actionId);
 const state=await module.status('coach-missing-followup','coach-missing-followup');expect(state?.jobs.map(j=>j.result?.outcome)).toEqual(['missing_facts','preserve']);expect(calls).toBe(2);expect(state?.jobs[0].result?.rationale).toContain('missing transcript section');
});
