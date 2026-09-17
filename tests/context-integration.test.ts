import {createContextModule,contextSnapshot} from '../server/review-context';
import {createReanalysisModule} from '../server/reanalysis';
import {createMediaModule} from '../server/media';
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
test('context edits preserve transcript/grouping, retain history, invalidate coaching and make no paid call',async()=>{
 const action=await ready('context-save');const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>coachResponse(init));const jobs=await coaching.begin(action);for(const job of jobs)await coaching.run(job);await coaching.finish(action);
 const context=createContextModule(db),old=await context.get('context-save','context-save');const changed={...old.context,role:'Staff engineer',resume:{text:'I contributed to a migration.',selected:true}};
 const updated=await context.save('context-save','context-save',{revision:old.revision,context:changed});expect(updated.revision).toBe(2);expect((await coaching.status('context-save','context-save'))?.state).toBe('outdated');
 expect(await db.prepare("SELECT input_revision,coaching_revision FROM reviews WHERE id='context-save'").first()).toEqual({input_revision:1,coaching_revision:2});expect(await db.prepare("SELECT state FROM transcriptions WHERE review_id='context-save'").first()).toEqual({state:'ready'});expect(await db.prepare('SELECT state FROM grouping_runs WHERE id=?').bind(action).first()).toEqual({state:'ready'});expect((await contextSnapshot(db,'context-save',1)).context.role).toBe('Engineer');
});
test('concurrent edits allow one winner and reject cross-owner writes',async()=>{
 await ready('context-concurrent');const module=createContextModule(db),old=await module.get('context-concurrent','context-concurrent');
 const attempts=await Promise.allSettled(['Lead','Senior'].map(role=>module.save('context-concurrent','context-concurrent',{revision:1,context:{...old.context,role}})));expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);await expect(module.get('other','context-concurrent')).rejects.toThrow();await expect(module.save('other','context-concurrent',{revision:2,context:old.context})).rejects.toThrow();
});
test('explicit reanalysis persists selected snapshot, deduplicates dispatch and waits for the account slot',async()=>{
 const action=await ready('context-rerun');const context=createContextModule(db),old=await context.get('context-rerun','context-rerun');await context.save('context-rerun','context-rerun',{revision:1,context:{...old.context,resume:{text:'I contributed to a migration.',selected:true}}});
 await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,created_at,deadline) VALUES('context-busy','context-rerun','context-rerun','context-busy-upload','running',0,9999999999999)").run();
 const calls:string[]=[];const reanalysis=createReanalysisModule({DB:db,MEDIA:bucket},async id=>{calls.push(id);if(calls.length===1)throw new Error('Lost dispatch reply');});const input={actionId:crypto.randomUUID(),contextRevision:2};
 await reanalysis.request('context-rerun','context-rerun',input);expect(calls).toHaveLength(0);await db.prepare("UPDATE processing_jobs SET state='ready' WHERE id='context-busy'").run();await reanalysis.reconcile();await reanalysis.reconcile();expect(calls).toHaveLength(1);await db.prepare('UPDATE coaching_runs SET dispatch_started_at=0 WHERE id=?').bind(input.actionId).run();await reanalysis.reconcile();expect(new Set(calls).size).toBe(1);expect(calls).toHaveLength(2);
 const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>coachResponse(init));const jobs=await coaching.begin(action,input.actionId);expect(jobs).toHaveLength(1);const source=JSON.parse((await db.prepare('SELECT sources FROM coaching_jobs WHERE id=?').bind(jobs[0]).first<{sources:string}>())!.sources);expect(source.context[0].contextId).toBe('context-rerun:context:2');
 for(const job of jobs)await coaching.run(job);await coaching.finish(input.actionId);await reanalysis.request('context-rerun','context-rerun',{...input,actionId:crypto.randomUUID()});expect(calls).toHaveLength(2);
});
test('an edit while grouping is running does not silently authorize coaching with new context',async()=>{
 const action=await ready('context-wait');const module=createContextModule(db),old=await module.get('context-wait','context-wait');await module.save('context-wait','context-wait',{revision:1,context:{...old.context,role:'Architect'}});
 expect(await createCoachingModule({DB:db,MEDIA:bucket}).begin(action)).toEqual([]);expect(await db.prepare("SELECT COUNT(*) AS n FROM coaching_runs WHERE review_id='context-wait'").first()).toEqual({n:0});
});
test('excluding context affects future snapshots while owner deletion erases retained context',async()=>{
 await ready('context-delete');const context=createContextModule(db),old=await context.get('context-delete','context-delete');const withResume={...old.context,resume:{text:'Private career detail.',selected:true}};await context.save('context-delete','context-delete',{revision:1,context:withResume});await context.save('context-delete','context-delete',{revision:2,context:{...withResume,resume:{...withResume.resume,selected:false}}});
 expect((await contextSnapshot(db,'context-delete',2)).context.resume.selected).toBe(true);
 const media=createMediaModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-secret-with-sufficient-length'});await media.remove('other','context-delete');expect((await context.get('context-delete','context-delete')).revision).toBe(3);
 await media.remove('context-delete','context-delete');await expect(context.get('context-delete','context-delete')).rejects.toThrow();expect(await db.prepare("SELECT COUNT(*) AS n FROM review_context_versions WHERE review_id='context-delete'").first()).toEqual({n:0});
});
test('resume project mentions do not license invented leadership or metrics',async()=>{
 const action=await ready('context-invented');const contexts=createContextModule(db),old=await contexts.get('context-invented','context-invented');await contexts.save('context-invented','context-invented',{revision:1,context:{...old.context,resume:{text:'I contributed to a migration.',selected:true},jobDescription:{text:'Lead a team and double revenue.',selected:true}}});
 const id=crypto.randomUUID();await createReanalysisModule({DB:db,MEDIA:bucket},async()=>{}).request('context-invented','context-invented',{actionId:id,contextRevision:2});
 let calls=0;const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{calls++;const body=JSON.parse(init!.body as string),payload=JSON.parse(body.input);if(payload.draft)return response({supported:false,issues:['Neither leadership nor revenue is supported by the selected resume.']});const source=payload.sources.context.find((s:{kind:string})=>s.kind==='background');return response({outcome:'improve',questionType:'past_project',rationale:'An alternative migration story addresses the question.',dimensions:['ownership'],segments:[{kind:'alternative',text:'I led the migration and doubled revenue.',citations:[{sourceId:source.sourceId,quote:source.quote}]}],missingFacts:[],limitations:[]});});
 const [job]=await module.begin(action,id);await module.run(job);expect(calls).toBe(2);expect((await module.status('context-invented','context-invented'))?.jobs[0].state).toBe('withheld');
});
test.skipIf(process.env.OPENAI_CONTEXT_SMOKE!=='1')('real OpenAI coaching uses the explicitly selected context snapshot',async()=>{
 const {parseEnv}=await import('node:util');const {writeFileSync}=await import('node:fs');const key=parseEnv(readFileSync('.env','utf8')).OPENAI_API_KEY;expect(Boolean(key)).toBe(true);
 const action=await ready('context-live');const contexts=createContextModule(db),old=await contexts.get('context-live','context-live');await contexts.save('context-live','context-live',{revision:1,context:{...old.context,resume:{text:'I built an internal deployment test tool that caught malformed manifests.',selected:true},jobDescription:{text:'An engineer who can explain their own decisions and project outcomes.',selected:true}}});
 const id=crypto.randomUUID();await createReanalysisModule({DB:db,MEDIA:bucket},async()=>{}).request('context-live','context-live',{actionId:id,contextRevision:2});const module=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:key},async(url,init)=>{const response=await fetch(url,init);if(!response.ok){const body=await response.clone().json() as {error?:{code?:string;message?:string}};console.error('Provider rejected request',response.status,body.error?.code,body.error?.message);}return response;});const [job]=await module.begin(action,id);
 try{await module.run(job);await module.finish(id);const status=await module.status('context-live','context-live');expect(['ready','partial']).toContain(status?.state);expect(['ready','withheld']).toContain(status?.jobs[0].state);if(status?.jobs[0].state==='ready')expect(status.jobs[0].result).not.toBeNull();else expect(status?.jobs[0].result).toBeNull();}
 finally{for(const stage of ['draft','verify']){const receipt=await bucket.get(`coaching/context-live/${job}-${stage}.provider.json`);if(receipt)writeFileSync(`/tmp/interviewcoach-context-${id}-${stage}.json`,await receipt.text(),{mode:0o600});}const rows=(await db.prepare('SELECT * FROM processing_budget WHERE id IN (?,?)').bind(job+'-draft',job+'-verify').all()).results;writeFileSync(`/tmp/interviewcoach-context-cost-${id}.json`,JSON.stringify(rows),{mode:0o600});}
},240000);

test('reanalysis dispatch retains one identity and stops after three lost deliveries',async()=>{
 const review='context-dispatch-limit';await ready(review);let calls=0;
 const module=createReanalysisModule({DB:db,MEDIA:bucket},async()=>{calls++;throw new Error('Lost reply');});
 const input={actionId:crypto.randomUUID(),contextRevision:1};await module.request(review,review,input);
 for(let i=0;i<5;i++){await db.prepare('UPDATE coaching_runs SET dispatch_started_at=0 WHERE id=?').bind(input.actionId).run();await module.reconcile();}
 expect(calls).toBe(3);
 await db.prepare('UPDATE coaching_runs SET deadline=0 WHERE id=?').bind(input.actionId).run();await module.reconcile();
 expect(await db.prepare('SELECT state FROM coaching_runs WHERE id=?').bind(input.actionId).first()).toEqual({state:'partial'});
 expect(calls).toBe(3);
});

test('expired reanalysis before job creation retries with a fresh identity and a finite allowance',async()=>{
 const review='context-empty-recovery',group=await ready(review),env={DB:db,MEDIA:bucket};const calls:string[]=[];
 const module=createReanalysisModule(env,async id=>{calls.push(id);});
 const original={actionId:crypto.randomUUID(),contextRevision:1};await module.request(review,review,original);
 await db.prepare('UPDATE coaching_runs SET deadline=0 WHERE id=?').bind(original.actionId).run();await module.reconcile();
 const retry={actionId:crypto.randomUUID(),contextRevision:1};
 const results=await Promise.all([module.request(review,review,retry),module.request(review,review,retry)]);
 expect(results.every(row=>row.id===retry.actionId)).toBe(true);
 expect(await createCoachingModule(env).begin(group,original.actionId)).toEqual([]);
 expect(calls.filter(id=>id===retry.actionId)).toHaveLength(1);
 await db.prepare('UPDATE coaching_runs SET deadline=0 WHERE id=?').bind(retry.actionId).run();await module.reconcile();
 await module.request(review,review,retry);await module.request(review,review,original);expect(calls).toHaveLength(2);
 const last={actionId:crypto.randomUUID(),contextRevision:1};await module.request(review,review,last);
 await db.prepare('UPDATE coaching_runs SET deadline=0 WHERE id=?').bind(last.actionId).run();await module.reconcile();
 await expect(module.request(review,review,{actionId:crypto.randomUUID(),contextRevision:1})).rejects.toThrow('three-attempt limit');
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(review).run();
 await expect(module.request(review,review,retry)).rejects.toThrow();
});

test('changed context waits for a historical provider outcome to reconcile before dispatch',async()=>{
 const review='context-unknown-history',group=await ready(review),env={DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'};
 const coaching=createCoachingModule(env,async()=>{throw new Error('Provider reply lost');});const [job]=await coaching.begin(group);await coaching.run(job);await coaching.finish(group);
 const context=createContextModule(db),old=await context.get(review,review);await context.save(review,review,{revision:1,context:{...old.context,role:'Staff engineer'}});
 let dispatches=0;const reanalysis=createReanalysisModule(env,async()=>{dispatches++;});const action={actionId:crypto.randomUUID(),contextRevision:2};await reanalysis.request(review,review,action);
 expect(dispatches).toBe(0);expect(await db.prepare('SELECT state FROM coaching_runs WHERE id=?').bind(action.actionId).first()).toEqual({state:'queued'});
 await bucket.put(`coaching/${review}/${job}-draft.provider.json`,JSON.stringify({response:JSON.stringify({usage:{input_tokens:-1}})}));
 await reanalysis.reconcile();expect(dispatches).toBe(0);expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(job+'-draft').first()).toEqual({state:'reserved'});
 await bucket.put(`coaching/${review}/${job}-draft.provider.json`,JSON.stringify({response:JSON.stringify({usage:{input_tokens:100,output_tokens:100,input_tokens_details:{cached_tokens:0}}})}));
 await reanalysis.reconcile();expect(dispatches).toBe(1);
 expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(job+'-draft').first()).toEqual({state:'settled'});
 expect(await db.prepare('SELECT state,result FROM coaching_jobs WHERE id=?').bind(job).first()).toEqual({state:'outdated',result:null});
});
