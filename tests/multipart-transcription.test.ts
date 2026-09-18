import {afterAll,beforeAll,test,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createTranscriptionModule,transcriptionIntent} from '../server/transcription';
import {createTranscriptionRetry} from '../server/transcription-retry';
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB'],r2Buckets:['MEDIA']}));
let db:D1Database,bucket:R2Bucket;
beforeAll(async()=>{
 db=await runtime.getD1Database('DB') as unknown as D1Database;bucket=await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
});
afterAll(()=>runtime.dispose());
async function fixture(){
 const id=crypto.randomUUID(),upload='upload-'+id;
 await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'','','mock',0,0)").bind(id,id).run();
 await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,result,created_at) VALUES(?,?,?,?,'ready',?,0)").bind(id,id,id,upload,JSON.stringify({audioKey:'source-'+id,sha256:'a'.repeat(64),durationMs:3600000})).run();
 await bucket.put('source-'+id,'audio');await transcriptionIntent(db,id).run();
 const env={DB:db,MEDIA:bucket,AUTH_SECRET:'test',OPENAI_API_KEY:'test',LOCAL_MEDIA_ADAPTER:'http://127.0.0.1:8790'};
 return {id,upload,env,transcriptId:'transcript-'+id};
}
function bundle(){
 const header=new TextEncoder().encode(JSON.stringify({version:1,chunks:[0,1,2].map(index=>({index,offsetMs:index*1200000,durationMs:1200000,bytes:1}))}));
 const bytes=new Uint8Array(4+header.length+3);new DataView(bytes.buffer).setUint32(0,header.length);bytes.set(header,4);bytes.set([1,2,3],4+header.length);return bytes;
}
const provider=()=>Response.json({duration:1200,segments:[{speaker:'A',text:'Why?',start:0,end:1},{speaker:'B',text:'My answer.',start:1199,end:1200}],usage:{type:'tokens',input_tokens:1,output_tokens:0}});
function adapter(paid:(identity:string)=>Promise<Response>){
 let compressions=0;
 const request:typeof fetch=async(input,init)=>{
  if(String(input).includes('/compression/')){compressions++;expect(new Headers(init?.headers).get('x-transcription-parts')).toBe('1');return new Response(bundle(),{headers:{'content-type':'application/vnd.interview-coach.transcription-parts'}});}
  return paid(new Headers(init?.headers).get('X-Client-Request-Id')!);
 };
 return {request,compressions:()=>compressions};
}
test('three bounded invocations publish the complete hour with one compression and distinct paid identities',async()=>{
 const {id,upload,env,transcriptId}=await fixture(),calls:string[]=[];
 const mock=adapter(async identity=>{calls.push(identity);return provider();}),module=createTranscriptionModule(env,mock.request);
 await Promise.all([module.run(id),module.run(id)]);
 expect(calls).toHaveLength(1);expect((await module.status(id,id))?.state).toBe('queued');
 expect(await bucket.head(`audio/${upload}/${transcriptId}/part-0.mp3`)).not.toBeNull();
 await module.run(id);await module.run(id);await module.run(id);
 expect(mock.compressions()).toBe(1);expect(new Set(calls).size).toBe(3);
 const state=await module.status(id,id);expect(state?.state).toBe('ready');expect(state?.transcript?.utterances.at(-1)?.endMs).toBe(3600000);
 expect(new Set(state?.transcript?.utterances.map(u=>u.speaker)).size).toBe(6);
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({settled_units:9});
});
test('a lost part outcome prevents further paid submissions and retains its reservation through cleanup',async()=>{
 const {id,env,transcriptId}=await fixture();let calls=0;
 const mock=adapter(async()=>{calls++;throw new Error('Lost response');}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);await module.cleanup();await module.run(id);
 expect(calls).toBe(1);expect((await module.status(id,id))?.state).toBe('unknown');
 expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({state:'reserved'});
});
test('known rejection retries only remaining parts with an incremental reservation',async()=>{
 const {id,env,transcriptId}=await fixture(),calls:string[]=[];let reject=true;
 const mock=adapter(async identity=>{calls.push(identity);return reject&&identity.endsWith('part-1')?new Response('',{status:400}):provider();}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);await module.run(id);
 expect((await module.status(id,id))?.state).toBe('failed');
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({settled_units:3});
 expect((await module.status(id,id))?.retry.maximumUnits).toBe(4000000);
 await createTranscriptionRetry(env).retry(id,id,{actionId:crypto.randomUUID(),transcriptId,attempt:0});
 reject=false;await module.run(id,1);
 await db.prepare('UPDATE recovery_requests SET created_at=0 WHERE target_id=?').bind(transcriptId).run();
 await createTranscriptionRetry(env).reconcile();
 expect((await module.status(id,id))?.state).toBe('queued');
 expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(transcriptId+'-attempt-1').first()).toEqual({state:'reserved'});
 await module.run(id,1);
 expect((await module.status(id,id))?.state).toBe('ready');expect(mock.compressions()).toBe(1);
 expect(calls.filter(call=>call.endsWith('part-0'))).toHaveLength(1);
 expect(await db.prepare('SELECT reserved_units,settled_units FROM processing_budget WHERE id=?').bind(transcriptId+'-attempt-1').first()).toEqual({reserved_units:4000000,settled_units:6});
});
test('deletion during a paid part retains known accounting without publishing content',async()=>{
 const {id,env,transcriptId}=await fixture();
 const mock=adapter(async()=>{await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();return provider();}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);await module.cleanup();
 expect(await module.status(id,id)).toBeNull();
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({settled_units:3});
 expect(await bucket.head(`transcripts/${id}/${transcriptId}-part-0.provider.json`)).toBeNull();
});

test('configuration loss after a completed part settles known usage and allows an incremental retry',async()=>{
 const {id,env,transcriptId}=await fixture();let calls=0;
 const mock=adapter(async()=>{calls++;return provider();}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);
 await createTranscriptionModule({...env,OPENAI_API_KEY:undefined},mock.request).run(id);
 expect((await module.status(id,id))?.state).toBe('configuration');
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({state:'settled',settled_units:3});
 await createTranscriptionRetry(env).retry(id,id,{actionId:crypto.randomUUID(),transcriptId,attempt:0});
 await module.run(id,1);await module.run(id,1);
 expect(calls).toBe(3);expect((await module.status(id,id))?.state).toBe('ready');
 expect(await db.prepare('SELECT reserved_units,settled_units FROM processing_budget WHERE id=?').bind(transcriptId+'-attempt-1').first()).toEqual({reserved_units:4000000,settled_units:6});
});
