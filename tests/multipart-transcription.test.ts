import {reconcileProviderBilling} from '../server/historical-billing';
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

test('late part billing is reconciled before deletion and every attempt artifact is swept again',async()=>{
 const {id,env,transcriptId,upload}=await fixture();
 const mock=adapter(async()=>{throw new Error('Lost response');}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);
 const receipt=`transcripts/${id}/${transcriptId}-part-0.provider.json`;
 await bucket.put(receipt,JSON.stringify({response:await provider().text()}));
 const extras=[0,1,2].flatMap(attempt=>[0,1,2].map(part=>`transcripts/${id}/${transcriptId}${attempt?'-attempt-'+attempt:''}-part-${part}.provider.json`)).filter(key=>key!==receipt);
 for(const key of extras)await bucket.put(key,'late test artifact');
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();
 await module.cleanup();
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({state:'settled',settled_units:3});
 for(const key of [receipt,...extras,...[0,1,2].map(part=>`audio/${upload}/${transcriptId}/part-${part}.mp3`)])expect(await bucket.head(key)).toBeNull();
 await bucket.put(receipt,JSON.stringify({response:await provider().text()}));await bucket.put(`audio/${upload}/${transcriptId}/part-0.mp3`,'late audio');
 await module.cleanup();
 expect(await bucket.head(receipt)).toBeNull();expect(await bucket.head(`audio/${upload}/${transcriptId}/part-0.mp3`)).toBeNull();
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({settled_units:3});
});
test('deleting a part with missing usage removes content but retains its unknown charge',async()=>{
 const {id,env,transcriptId}=await fixture();
 const mock=adapter(async()=>Response.json({duration:1200,segments:[]})),module=createTranscriptionModule(env,mock.request);
 await module.run(id);
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();await module.cleanup();
 expect(await db.prepare('SELECT state,settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({state:'reserved',settled_units:null});
 expect(await bucket.head(`transcripts/${id}/${transcriptId}-part-0.provider.json`)).toBeNull();
});
test('receipt storage failure prevents destructive cleanup until billing can be read',async()=>{
 const {id,env,transcriptId}=await fixture();
 const mock=adapter(async()=>{throw new Error('Lost response');}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);
 const receipt=`transcripts/${id}/${transcriptId}-part-0.provider.json`;
 await bucket.put(receipt,JSON.stringify({response:await provider().text()}));
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();
 const failingBucket=new Proxy(bucket,{get(target,key){if(key==='get')return async(name:string)=>{if(name===receipt)throw new Error('Storage unavailable');return target.get(name);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await expect(createTranscriptionModule({...env,MEDIA:failingBucket}).cleanup()).rejects.toThrow('Storage unavailable');
 expect(await bucket.head(receipt)).not.toBeNull();
 expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({state:'reserved'});
 await module.cleanup();
 expect(await bucket.head(receipt)).toBeNull();
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({settled_units:3});
});

test('historical reconciliation captures part usage but keeps the active partial reservation',async()=>{
 const {id,env,transcriptId}=await fixture();
 const mock=adapter(async()=>{throw new Error('Lost response');}),module=createTranscriptionModule(env,mock.request);
 await module.run(id);
 await bucket.put(`transcripts/${id}/${transcriptId}-part-0.provider.json`,JSON.stringify({response:JSON.stringify({segments:'invalid',usage:{type:'tokens',input_tokens:1,output_tokens:0}})}));
 await reconcileProviderBilling(env);
 expect(await db.prepare('SELECT state,charge_units FROM transcription_parts WHERE transcription_id=? AND part_index=0').bind(transcriptId).first()).toEqual({state:'unknown',charge_units:3});
 expect(await db.prepare('SELECT state FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({state:'reserved'});
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();await module.cleanup();
 expect(await db.prepare('SELECT settled_units FROM processing_budget WHERE id=?').bind(transcriptId).first()).toEqual({settled_units:3});
});
