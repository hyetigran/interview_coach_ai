import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {youtubeVideoId,youtubeEndSeconds} from '../lib/media/youtube';
import {createMediaModule} from '../server/media';
import {createReviewModule} from '../server/reviews';
import {createProcessingModule} from '../server/processing';
import {createPreparationRetry} from '../server/preparation-retry';
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB'],r2Buckets:['MEDIA']}));
let db:D1Database,bucket:R2Bucket;
beforeAll(async()=>{
 db=await runtime.getD1Database('DB') as unknown as D1Database;bucket=await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
});
afterAll(()=>runtime.dispose());
const url='https://www.youtube.com/watch?v=sa41eWwM7iI';
const env=()=>({DB:db,MEDIA:new Proxy(bucket,{get(target,property){
 if(property==='put')return async(key:string,body:ReadableStream,options:R2PutOptions)=>target.put(key,await new Response(body).arrayBuffer(),options);
 const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
}}),AUTH_SECRET:'test-secret',LOCAL_MEDIA_ADAPTER:'http://127.0.0.1:8790'});
const input=()=>({url,endSeconds:2320,actionId:crypto.randomUUID()});
const review=(owner:string)=>createReviewModule(db).create(owner,{title:'Link import',role:'Engineer',origin:'mock'});
function wav(){const b=new Uint8Array(32044),v=new DataView(b.buffer);for(const [offset,value] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']] as const)b.set(new TextEncoder().encode(value),offset);v.setUint32(4,b.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,32000,true);return b;}
test('canonicalizes video links and rejects non-YouTube URLs and injected identifiers',()=>{
 for(const link of [url,'https://youtu.be/sa41eWwM7iI?si=tracking','https://m.youtube.com/shorts/sa41eWwM7iI'])expect(youtubeVideoId(link)).toBe('sa41eWwM7iI');
 for(const link of ['http://youtube.com/watch?v=sa41eWwM7iI','https://youtube.com.evil.test/watch?v=sa41eWwM7iI','https://youtube.com@127.0.0.1/watch?v=sa41eWwM7iI','https://youtube.com/playlist?list=abc','https://youtube.com:444/watch?v=sa41eWwM7iI','file:///etc/passwd','https://youtu.be/--exec'])expect(()=>youtubeVideoId(link)).toThrow();
 expect(youtubeEndSeconds('38:38')).toBe(2318);expect(youtubeEndSeconds('1:00:00')).toBe(3600);expect(youtubeEndSeconds('')).toBeUndefined();for(const time of ['00:00','38:99','1:00:01','NaN'])expect(()=>youtubeEndSeconds(time)).toThrow();
});
test('link and file admissions share an atomic allowance; repeat link returns the existing intent',async()=>{
 const media=createMediaModule(env()),r=await review('link-race');
 const results=await Promise.all(Array.from({length:6},()=>media.importYoutube('link-race',r.id,input())));
 expect(new Set(results.map(r=>r.id)).size).toBe(1);
 expect((await db.prepare('SELECT id FROM processing_jobs WHERE review_id=?').bind(r.id).all()).results).toHaveLength(1);
 await expect(media.importYoutube('other-owner',r.id,input())).rejects.toMatchObject({status:404});
 await expect(media.importYoutube('link-race',r.id,{...input(),endSeconds:100})).rejects.toMatchObject({status:409});
 const r2=await review('link-race'),r3=await review('link-race'),r4=await review('link-race');
 await media.initiate('link-race',r2.id,{name:'local.wav',size:100,actionId:crypto.randomUUID()});
 await media.importYoutube('link-race',r3.id,input());
 await expect(media.importYoutube('link-race',r4.id,input())).rejects.toMatchObject({status:409});
});
test('imports once into private storage and reuses the prepared checkpoint for playback',async()=>{
 const owner='link-ready',r=await review(owner),media=createMediaModule(env()),u=await media.importYoutube(owner,r.id,input());
 const processing=createProcessingModule(env(),async()=>{});await processing.reconcile();
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  expect(new Headers(init?.headers).get('x-youtube-import')).toBe('1');expect(JSON.parse(init?.body as string)).toEqual({videoId:'sa41eWwM7iI',endSeconds:2320});
  return new Response(wav(),{headers:{'content-length':'32044'}});
 });
 try{const result=await processing.prepare('prepare-'+u.id);expect(result.durationMs).toBe(1000);expect((await media.status(owner,r.id)).upload?.state).toBe('admitted');expect(await processing.prepare('prepare-'+u.id)).toEqual(result);expect(fetcher).toHaveBeenCalledTimes(1);expect((await media.play(owner,r.id,'bytes=0-43')).status).toBe(206);}
 finally{fetcher.mockRestore();}
});
test('a failed link import can retry before an original exists; deletion prevents late publication',async()=>{
 const owner='link-cancel',r=await review(owner),media=createMediaModule(env()),u=await media.importYoutube(owner,r.id,input());
 const processing=createProcessingModule(env(),async()=>{},async()=>{});await processing.reconcile();await processing.fail('prepare-'+u.id);await processing.reconcile();
 await createPreparationRetry(env(),processing).retry(owner,r.id,{actionId:crypto.randomUUID(),jobId:'prepare-'+u.id,attempt:0});
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(r.id).run();return new Response(wav(),{headers:{'content-length':'32044'}});});
 try{await expect(processing.prepare('prepare-'+u.id,1)).rejects.toThrow();expect(await bucket.head('originals/'+u.id)).toBeNull();}
 finally{fetcher.mockRestore();}
 await media.remove(owner,r.id);
 const row=await db.prepare('SELECT youtube_id,youtube_end_seconds FROM uploads WHERE id=?').bind(u.id).first();expect(row).toEqual({youtube_id:null,youtube_end_seconds:null});
});
test('a duplicate late preparation delivery cannot delete the successful source',async()=>{
 const owner='link-duplicate',r=await review(owner),media=createMediaModule(env()),u=await media.importYoutube(owner,r.id,input());
 const base=env();let release!:()=>void,entered!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;}),secondPut=new Promise<void>(resolve=>{entered=resolve;});let puts=0;
 const observed=new Proxy(base.MEDIA,{get(target,property){
  if(property==='put')return async(key:string,body:ReadableStream,options:R2PutOptions)=>{if(++puts===2){entered();await blocked;}return target.put(key,body,options);};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const processing=createProcessingModule({...base,MEDIA:observed},async()=>{});await processing.reconcile();
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(wav(),{headers:{'content-length':'32044'}}));
 try{
  const a=processing.prepare('prepare-'+u.id),b=processing.prepare('prepare-'+u.id);
  const outcomes=Promise.allSettled([a,b]);
  await secondPut;await Promise.race([a,b]);release();
  const results=await outcomes;expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await bucket.head('originals/'+u.id)).not.toBeNull();expect((await media.play(owner,r.id,null)).status).toBe(200);
 }finally{release();fetcher.mockRestore();}
});
test('drains failed service responses so the container can record known completion',async()=>{
 const owner='link-failed-response',r=await review(owner),u=await createMediaModule(env()).importYoutube(owner,r.id,input());
 const processing=createProcessingModule(env(),async()=>{});await processing.reconcile();let drained=false;
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('Unavailable'));},pull(controller){drained=true;controller.close();}}),{status:503}));
 try{await expect(processing.prepare('prepare-'+u.id)).rejects.toThrow(/YouTube import/);expect(drained).toBe(true);expect(await bucket.head('originals/'+u.id)).toBeNull();}
 finally{fetcher.mockRestore();}
});

test('reports a transport interruption without blaming video availability',async()=>{
 const owner='link-transport',r=await review(owner),u=await createMediaModule(env()).importYoutube(owner,r.id,input());
 const processing=createProcessingModule(env(),async()=>{});await processing.reconcile();
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('Interrupted',{status:502,headers:{'x-media-error':'transport'}}));
 try{await expect(processing.prepare('prepare-'+u.id)).rejects.toThrow('The media service connection was interrupted. Your link is saved.');expect(await bucket.head('originals/'+u.id)).toBeNull();}
 finally{fetcher.mockRestore();}
});


test('preserves a saved link and reports an upstream refusal distinctly',async()=>{
 const owner='link-forbidden',r=await review(owner),media=createMediaModule(env()),u=await media.importYoutube(owner,r.id,input());
 const processing=createProcessingModule(env(),async()=>{});await processing.reconcile();
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('Refused',{status:503,headers:{'x-youtube-error':'forbidden'}}));
 try{await expect(processing.prepare('prepare-'+u.id)).rejects.toThrow('YouTube refused this download (HTTP 403).');expect((await media.status(owner,r.id)).upload?.id).toBe(u.id);}
 finally{fetcher.mockRestore();}
});
