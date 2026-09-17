import {createCoachingModule} from '../server/coaching';
import {createGroupingCorrectionModule} from '../server/grouping-corrections';
import {createCorrectionModule} from '../server/transcript-corrections';
import {createMediaModule} from '../server/media';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createSpeakerModule } from '../server/speakers';
import { createGroupingModule } from '../server/grouping';
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
test('manual grouping versions are owner-scoped, reject stale graph writes and refresh without another grouping call',async()=>{
 const action=await ready('manual-group');const before=await createGroupingModule({DB:db,MEDIA:bucket}).status('manual-group','manual-group');expect(before&&'version' in before).toBe(true);if(!before||!('version' in before))throw new Error('Fixture grouping absent');
 const input={transcriptId:'t-manual-group',groupingId:action,version:before.version,groups:[{key:'question',question:[{utteranceId:'u0',start:0,end:31}],answers:[{utteranceId:'u1',start:2,end:35}],parent:null}]};const module=createGroupingCorrectionModule({DB:db,MEDIA:bucket});await expect(module.grouping('other','manual-group',input)).rejects.toThrow();
 const corrected=await module.grouping('manual-group','manual-group',input);await expect(module.grouping('manual-group','manual-group',input)).rejects.toThrow();const next=crypto.randomUUID();await createCorrectionModule({DB:db,MEDIA:bucket}).refresh('manual-group','manual-group',{actionId:next,transcriptId:corrected.id});const speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});await speakers.reconcile();let calls=0;const grouping=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response();});const count=await grouping.begin(next);await speakers.resume(next);for(let i=0;i<count;i++)await grouping.runChunk(next,i);await grouping.finish(next);expect(calls).toBe(0);expect((await grouping.status('manual-group','manual-group'))?.groups[0].answers[0].start).toBe(2);
 await createMediaModule({DB:db,MEDIA:bucket,AUTH_SECRET:'test-secret'}).remove('manual-group','manual-group');expect(await db.prepare('SELECT manual_groups,candidate_speakers FROM transcript_correction_intents WHERE id=?').bind(corrected.id).first()).toEqual({manual_groups:null,candidate_speakers:null});
});
test('role-only corrections create a new immutable version and preserve the explicit candidate selection for refresh',async()=>{
 await ready('manual-role');const module=createGroupingCorrectionModule({DB:db,MEDIA:bucket});await expect(module.status('other','manual-role')).rejects.toThrow('Transcript unavailable');expect(await module.status('manual-role','manual-role')).toEqual({transcriptId:'t-manual-role',revision:1,candidateSpeakers:['B']});const input={transcriptId:'t-manual-role',candidateSpeakers:['B'],passages:[{utteranceId:'u0',role:'unknown',overlap:true}]};const corrections=await Promise.allSettled([module.attribution('manual-role','manual-role',input),module.attribution('manual-role','manual-role',input)]);expect(corrections.filter(r=>r.status==='fulfilled')).toHaveLength(1);const winner=corrections.find(r=>r.status==='fulfilled');if(winner?.status!=='fulfilled')throw new Error('No correction');
 const row=await db.prepare('SELECT result_key FROM transcriptions WHERE id=?').bind(winner.value.id).first<{result_key:string}>();const document=await (await bucket.get(row!.result_key))!.json<{utterances:{speaker:string|null;text:string;overlap:boolean}[]}>();expect(document.utterances[0]).toMatchObject({speaker:null,text:'Tell me about a project you led.',overlap:true});expect(await bucket.get('document-manual-role')).not.toBeNull();
 expect(await module.status('manual-role','manual-role')).toEqual({transcriptId:winner.value.id,revision:2,candidateSpeakers:['B']});
 const next=crypto.randomUUID();await createCorrectionModule({DB:db,MEDIA:bucket}).refresh('manual-role','manual-role',{actionId:next,transcriptId:winner.value.id});expect(await db.prepare('SELECT speakers FROM speaker_confirmations WHERE id=?').bind(next).first()).toEqual({speakers:'["B"]'});
});
test('a late grouping result invalidates an open correction even when the transcript version is unchanged',async()=>{
 const id='late-group',action=await ready(id),module=createGroupingCorrectionModule({DB:db,MEDIA:bucket});
 const grouping=createGroupingModule({DB:db,MEDIA:bucket});const snapshot=await grouping.status(id,id);if(!snapshot||!('version' in snapshot))throw new Error('Missing grouping');
 await db.prepare("UPDATE grouping_chunks SET result='[]' WHERE run_id=?").bind(action).run();
 await expect(module.grouping(id,id,{transcriptId:'t-'+id,groupingId:action,version:snapshot.version,groups:[]})).rejects.toThrow('Question grouping changed');
 expect(await module.status(id,id)).toMatchObject({transcriptId:'t-'+id,revision:1});
});
test('an obsolete model response cannot publish after a role-only correction',async()=>{
 const id='obsolete-attribution',{actionId,speakers}=await setup(id);
 let release:()=>void=()=>{},started:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),submitted=new Promise<void>(resolve=>{started=resolve;});
 const grouping=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{started();await gate;return response();});await grouping.begin(actionId);await speakers.resume(actionId);const pending=grouping.runChunk(actionId,0);await submitted;
 try{await createGroupingCorrectionModule({DB:db,MEDIA:bucket}).attribution(id,id,{transcriptId:'t-'+id,candidateSpeakers:['B'],passages:[{utteranceId:'u0',role:'unknown',overlap:true}]});}finally{release();}
 await pending;await grouping.finish(actionId);
 expect(await db.prepare('SELECT result FROM grouping_chunks WHERE run_id=?').bind(actionId).first()).toEqual({result:null});
});
test('manual graphs spanning later windows require reassociation when their selected evidence changes',async()=>{
 const id='manual-long',{actionId,speakers}=await setup(id,50),grouping=createGroupingModule({DB:db,MEDIA:bucket});
 await grouping.begin(actionId);await speakers.resume(actionId);await db.prepare("UPDATE grouping_chunks SET state='ready',result='[]' WHERE run_id=?").bind(actionId).run();await grouping.finish(actionId);
 const status=await grouping.status(id,id);if(!status||!('version' in status))throw new Error('Missing grouping');
 const corrected=await createGroupingCorrectionModule({DB:db,MEDIA:bucket}).grouping(id,id,{transcriptId:'t-'+id,groupingId:actionId,version:status.version,groups:[{key:'late',question:[{utteranceId:'u48',start:0,end:31}],answers:[{utteranceId:'u49',start:0,end:'I led the rollout with two engineers.'.length}],parent:null}]});
 const manual=crypto.randomUUID(),corrections=createCorrectionModule({DB:db,MEDIA:bucket});await corrections.refresh(id,id,{transcriptId:corrected.id,actionId:manual});await speakers.reconcile();await grouping.begin(manual);await speakers.resume(manual);await grouping.finish(manual);
 const wording=await corrections.save(id,id,{transcriptId:corrected.id,utteranceId:'u49',text:'I supported the rollout.',recordingOnly:true});const next=crypto.randomUUID();await expect(corrections.refresh(id,id,{transcriptId:wording.id,actionId:next})).rejects.toThrow('Review and save question groups');
 const pending=await grouping.status(id,id);expect(pending?.state).toBe('needs_review');await expect(speakers.confirm(id,id,{transcriptId:wording.id,actionId:crypto.randomUUID(),speakers:['B']})).rejects.toThrow('Review saved question groups');expect(pending?.groups[0].answers[0].quote).toBe('I led the rollout with two engineers.');
 const repaired=await createGroupingCorrectionModule({DB:db,MEDIA:bucket}).grouping(id,id,{transcriptId:wording.id,groupingId:wording.id,version:0,groups:[{key:'late',question:[{utteranceId:'u48',start:0,end:31}],answers:[{utteranceId:'u49',start:0,end:'I supported the rollout.'.length}],parent:null}]});
 await corrections.refresh(id,id,{transcriptId:repaired.id,actionId:next});await speakers.reconcile();await grouping.begin(next);await speakers.resume(next);await grouping.finish(next);
 const final=await grouping.status(id,id);expect(final?.groups[0].answers[0]).toMatchObject({quote:'I supported the rollout.',transcriptId:repaired.id});
});

test('compatible wording and role corrections retain explicit associations before the first refresh',async()=>{
 const id='manual-inherited',action=await ready(id),grouping=createGroupingModule({DB:db,MEDIA:bucket});const original=await grouping.status(id,id);if(!original||!('version' in original))throw new Error('Missing grouping');
 const module=createGroupingCorrectionModule({DB:db,MEDIA:bucket});const first=await module.grouping(id,id,{transcriptId:'t-'+id,groupingId:action,version:original.version,groups:[{key:'root',question:[{utteranceId:'u0',start:0,end:31}],answers:[{utteranceId:'u1',start:2,end:16}],parent:null}]});
 const second=await module.attribution(id,id,{transcriptId:first.id,candidateSpeakers:['B'],passages:[{utteranceId:'u0',role:'unknown',overlap:true}]});
 const retained=await grouping.status(id,id);expect(retained?.state).toBe('corrected');expect(retained?.groups[0].answers[0]).toMatchObject({quote:'led the rollou',start:2,end:16,transcriptId:second.id});expect(retained?.groups[0].uncertain).toBe(true);
 const next=crypto.randomUUID();await createCorrectionModule({DB:db,MEDIA:bucket}).refresh(id,id,{transcriptId:second.id,actionId:next});const speakers=createSpeakerModule({DB:db,MEDIA:bucket},async()=>{});await speakers.reconcile();let calls=0;const refreshed=createGroupingModule({DB:db,MEDIA:bucket,OPENAI_API_KEY:'test'},async()=>{calls++;return response();});const count=await refreshed.begin(next);await speakers.resume(next);for(let i=0;i<count;i++)await refreshed.runChunk(next,i);await refreshed.finish(next);expect(calls).toBe(0);expect((await refreshed.status(id,id))?.groups[0].answers[0].end).toBe(16);
});

test('partial coverage cannot become complete after an unselected wording edit shifts window boundaries',async()=>{
 const id='coverage-shift',{actionId,speakers}=await setup(id,30);
 const document=await (await bucket.get('document-'+id))!.json<{utterances:{text:string}[]}>();document.utterances.forEach((u,i)=>{u.text='x'.repeat(i<4?50000:1000);});await bucket.put('document-'+id,JSON.stringify(document));
 const grouping=createGroupingModule({DB:db,MEDIA:bucket});expect(await grouping.begin(actionId)).toBeGreaterThan(1);await speakers.resume(actionId);await db.prepare("UPDATE grouping_chunks SET state=CASE WHEN ordinal=0 THEN 'ready' ELSE 'failed' END,result='[]' WHERE run_id=?").bind(actionId).run();await grouping.finish(actionId);
 const initial=await grouping.status(id,id);if(!initial||!('version' in initial))throw new Error('Missing grouping');
 const manual=await createGroupingCorrectionModule({DB:db,MEDIA:bucket}).grouping(id,id,{transcriptId:'t-'+id,groupingId:actionId,version:initial.version,groups:[{key:'root',question:[{utteranceId:'u2',start:0,end:1}],answers:[{utteranceId:'u3',start:0,end:1}],parent:null}]});
 const corrections=createCorrectionModule({DB:db,MEDIA:bucket}),changed=await corrections.save(id,id,{transcriptId:manual.id,utteranceId:'u0',text:'Short introduction.',recordingOnly:true});
 expect(await db.prepare('SELECT coverage,manual_review FROM transcript_correction_intents WHERE id=?').bind(changed.id).first()).toEqual({coverage:'[]',manual_review:0});
 const next=crypto.randomUUID();await corrections.refresh(id,id,{transcriptId:changed.id,actionId:next});await speakers.reconcile();await grouping.begin(next);await speakers.resume(next);await grouping.finish(next);expect((await grouping.status(id,id))?.state).toBe('partial');
 const coaching=createCoachingModule({DB:db,MEDIA:bucket});await coaching.begin(next);const jobs=(await db.prepare('SELECT sources FROM coaching_jobs WHERE run_id=?').bind(next).all<{sources:string}>()).results;expect(jobs.length).toBeGreaterThan(0);expect(jobs.every(job=>JSON.parse(job.sources).incomplete===true)).toBe(true);
});
