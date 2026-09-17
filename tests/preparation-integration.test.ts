import {createPreparationModule} from '../server/preparation';
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

test('saved future answers retain original provenance while newer coaching completes and make no paid calls',async()=>{
 const action=await ready('save-answer');const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>coachResponse(init));const [job]=await coaching.begin(action);await coaching.run(job);
 const module=createPreparationModule(db);const [answer]=await Promise.all([module.save('save-answer','save-answer',{jobId:job,version:0,text:'My future answer.'}),coaching.finish(action)]);expect(answer.version).toBe(1);expect((await module.get('save-answer','save-answer')).answers[0].text).toBe('My future answer.');
 const previousBudget=await db.prepare('SELECT COUNT(*) AS n FROM processing_budget').first();await module.save('save-answer','save-answer',{jobId:job,version:1,text:'My revised future answer.'});expect(await db.prepare('SELECT COUNT(*) AS n FROM processing_budget').first()).toEqual(previousBudget);expect(await db.prepare("SELECT COUNT(*) AS n FROM saved_answers WHERE review_id='save-answer'").first()).toEqual({n:2});
 await expect(module.save('other','save-answer',{jobId:job,version:2,text:'Unauthorized'})).rejects.toThrow();await expect(module.get('other','save-answer')).rejects.toThrow();
 const attempts=await Promise.allSettled(['A','B'].map(text=>module.save('save-answer','save-answer',{jobId:job,version:2,text})));expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 await db.prepare("UPDATE coaching_jobs SET state='cancelled',sources=NULL,result=NULL WHERE id=?").bind(job).run();await module.save('save-answer','save-answer',{jobId:job,version:3,text:'Saved work remains editable after the generated source is superseded.'});
 expect((await db.prepare('SELECT sources FROM saved_answers WHERE id=?').bind(answer.id).first<{sources:string}>())!.sources).toContain('I led the rollout');
});
test('priority limit is server enforced, concurrent edits conflict, and deletion removes saved content',async()=>{
 const action=await ready('priorities');const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>coachResponse(init));const [job]=await coaching.begin(action);await coaching.run(job);const module=createPreparationModule(db);
 await expect(module.priorities('priorities','priorities',{version:0,items:['1','2','3','4']})).rejects.toThrow();await module.priorities('priorities','priorities',{version:0,items:['Explain ownership','Give a decision','Name the outcome']});
 const writes=await Promise.allSettled(['A','B'].map(item=>module.priorities('priorities','priorities',{version:1,items:[item]})));expect(writes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await module.get('priorities','priorities')).priorities.version).toBe(2);
 await module.save('priorities','priorities',{jobId:job,version:0,text:'Personal preparation'});const media=createMediaModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-secret-with-sufficient-length'});await media.remove('other','priorities');expect((await module.get('priorities','priorities')).answers).toHaveLength(1);await media.remove('priorities','priorities');await expect(module.get('priorities','priorities')).rejects.toThrow();expect(await db.prepare("SELECT COUNT(*) AS n FROM saved_answers WHERE review_id='priorities'").first()).toEqual({n:0});expect(await db.prepare("SELECT COUNT(*) AS n FROM review_priorities WHERE review_id='priorities'").first()).toEqual({n:0});
});

test('an unsaved answer can be saved against its completed original result after reanalysis makes it outdated',async()=>{
 const action=await ready('outdated-draft');const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>coachResponse(init));const [job]=await coaching.begin(action);await coaching.run(job);await coaching.finish(action);
 await db.prepare("UPDATE reviews SET coaching_revision=coaching_revision+1 WHERE id='outdated-draft'").run();await coaching.cleanup();expect(await db.prepare('SELECT state FROM coaching_jobs WHERE id=?').bind(job).first()).toEqual({state:'outdated'});
 const module=createPreparationModule(db),saved=await module.save('outdated-draft','outdated-draft',{jobId:job,version:0,text:'Draft begun before reanalysis.'});expect(saved.jobId).toBe(job);expect((await module.evidence('outdated-draft','outdated-draft',saved.id)).sources.answers[0].quote).toBe('I led the rollout with two engineers.');await expect(module.evidence('other','outdated-draft',saved.id)).rejects.toThrow();
});
