import {createPreparationModule} from '../server/preparation';
import {createCorrectionModule} from '../server/transcript-corrections';
import {createTranscriptionModule} from '../server/transcription';
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


test('corrections retain immutable originals, revoke stale generation and preserve audio bounds without paid work',async()=>{
 const action=await ready('correction-race');let resolveProvider:()=>void=()=>{},started:()=>void=()=>{};const gate=new Promise<void>(resolve=>{resolveProvider=resolve;}),submitted=new Promise<void>(resolve=>{started=resolve;});
 const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{started();await gate;return coachResponse(init);});const [job]=await coaching.begin(action);const inFlight=coaching.run(job);await submitted;
 const beforeBudget=await db.prepare('SELECT COUNT(*) AS n FROM processing_budget').first();const corrections=createCorrectionModule({DB:db,MEDIA:bucket});const corrected=await corrections.save('correction-race','correction-race',{transcriptId:'t-correction-race',utteranceId:'u1',text:'I co-led the rollout 🧑🏽‍💻.',recordingOnly:true});expect(await db.prepare('SELECT COUNT(*) AS n FROM processing_budget').first()).toEqual(beforeBudget);resolveProvider();await inFlight;
 expect(await db.prepare('SELECT result FROM coaching_jobs WHERE id=?').bind(job).first()).toEqual({result:null});
 const transcription=createTranscriptionModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-secret'});await transcription.cleanup();const current=await transcription.status('correction-race','correction-race');expect(current?.id).toBe(corrected.id);expect(current?.transcript?.utterances[1]).toMatchObject({text:'I co-led the rollout 🧑🏽‍💻.',startMs:1000,endMs:2000});expect((await bucket.get('document-correction-race'))).not.toBeNull();
 await createGroupingModule({DB:db,MEDIA:bucket}).cleanup();expect(await db.prepare('SELECT state FROM grouping_runs WHERE id=?').bind(action).first()).toEqual({state:'outdated'});expect((await db.prepare('SELECT result FROM grouping_chunks WHERE run_id=?').bind(action).first<{result:string}>())!.result).toContain('I led the rollout');
});
test('only one concurrent correction wins, cross-owner edits fail, and deletion removes every corrected snapshot',async()=>{
 await ready('correction-conflict');const module=createCorrectionModule({DB:db,MEDIA:bucket}),input={transcriptId:'t-correction-conflict',utteranceId:'u1',recordingOnly:true};await expect(module.save('other','correction-conflict',{...input,text:'Other owner'})).rejects.toThrow();
 const results=await Promise.allSettled(['First correction','Second correction'].map(text=>module.save('correction-conflict','correction-conflict',{...input,text})));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const media=createMediaModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-secret'});await media.remove('correction-conflict','correction-conflict');const objects=await bucket.list({prefix:'transcripts/correction-conflict/'});expect(objects.objects).toHaveLength(0);
});
test('explicit refresh reuses unchanged grouping and coaching and spends only on the affected suffix',async()=>{
 const {actionId,speakers}=await setup('incremental',50);let groupCalls=0,coachCalls=0;
 const grouping=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{
  groupCalls++;const payload=JSON.parse(JSON.parse(init!.body as string).input);const utterances=payload.utterances as {id:string;text:string}[];const q=utterances.find(u=>Number(u.id.slice(1))%24===0)!;const a=utterances.find(u=>Number(u.id.slice(1))===Number(q.id.slice(1))+1)!;
  return response({groups:[{question:[{utteranceId:q.id,quote:q.text}],answers:[{utteranceId:a.id,quote:a.text}],parent:null,uncertain:false}]});
 });
 const coaching=createCoachingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async(_url,init)=>{coachCalls++;return coachResponse(init);});
 let count=await grouping.begin(actionId);await speakers.resume(actionId);for(let i=0;i<count;i++)await grouping.runChunk(actionId,i);let jobs=await coaching.begin(actionId);await grouping.finish(actionId);for(const job of jobs)await coaching.run(job);await coaching.finish(actionId);expect(groupCalls).toBe(3);expect(coachCalls).toBe(6);
 const annotations=createPreparationModule(db);const saved=await annotations.save('incremental','incremental',{jobId:jobs[0],version:0,text:'My saved preparation before correction.'});
 const corrections=createCorrectionModule({DB:db,MEDIA:bucket});let corrected=await corrections.save('incremental','incremental',{transcriptId:'t-incremental',utteranceId:'u49',text:'I co-led this rollout.',recordingOnly:true});expect(groupCalls).toBe(3);expect(coachCalls).toBe(6);
 corrected=await corrections.save('incremental','incremental',{transcriptId:corrected.id,utteranceId:'u49',text:'I co-led this corrected rollout.',recordingOnly:true});
 const next=crypto.randomUUID();await corrections.refresh('incremental','incremental',{actionId:next,transcriptId:corrected.id});await speakers.reconcile();count=await grouping.begin(next);await speakers.resume(next);for(let i=0;i<count;i++)await grouping.runChunk(next,i);jobs=await coaching.begin(next);await grouping.finish(next);for(const job of jobs)await coaching.run(job);await coaching.finish(next);
 expect(groupCalls).toBe(4);expect(coachCalls).toBe(8);expect((await coaching.status('incremental','incremental'))?.state).toBe('ready');expect((await grouping.status('incremental','incremental'))?.groups).toHaveLength(3);expect((await grouping.status('incremental','incremental'))?.previous?.advice).toHaveLength(3);expect((await annotations.get('incremental','incremental')).answers[0].id).toBe(saved.id);expect((await annotations.evidence('incremental','incremental',saved.id)).sources.answers[0].transcriptId).toBe('t-incremental');
});
test('video-derived range playback survives wording corrections without re-preparation',async()=>{
 await ready('video-correction');await db.prepare("INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at,admitted_at) VALUES('video-correction-upload','video-correction','video-correction','video-action','recording.mp4',100,'admitted','original-video',9999999999999,0,0)").run();
 await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,revision,state,created_at,result) VALUES('video-preparation','video-correction','video-correction','video-correction-upload',1,'ready',0,?)").bind(JSON.stringify({audioKey:'derived-audio',audioBytes:100})).run();await bucket.put('derived-audio',new Uint8Array(100));
 const media=createMediaModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-secret'});expect((await media.play('video-correction','video-correction','bytes=10-19')).status).toBe(206);
 await createCorrectionModule({DB:db,MEDIA:bucket}).save('video-correction','video-correction',{transcriptId:'t-video-correction',utteranceId:'u1',text:'A wording correction.',recordingOnly:true});const audio=await media.play('video-correction','video-correction','bytes=10-19');expect(audio.status).toBe(206);expect(audio.headers.get('content-range')).toBe('bytes 10-19/100');expect((await audio.arrayBuffer()).byteLength).toBe(10);
});
test('prefix reuse is disabled when confirmed candidate speaker labels change',async()=>{
 const {actionId,speakers}=await setup('changed-speakers',50);const grouping=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>response());await grouping.begin(actionId);await speakers.resume(actionId);await grouping.runChunk(actionId,0);
 const corrections=createCorrectionModule({DB:db,MEDIA:bucket});const corrected=await corrections.save('changed-speakers','changed-speakers',{transcriptId:'t-changed-speakers',utteranceId:'u49',text:'Corrected later answer.',recordingOnly:true});await grouping.cleanup();const next=crypto.randomUUID();await speakers.confirm('changed-speakers','changed-speakers',{actionId:next,transcriptId:corrected.id,speakers:['A']});await grouping.begin(next);
 expect(await db.prepare('SELECT state FROM grouping_chunks WHERE run_id=? AND ordinal=0').bind(next).first()).toEqual({state:'queued'});
});
