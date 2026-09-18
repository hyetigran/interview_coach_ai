import {beforeAll,afterAll,test,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createTranscriptionPartStore} from '../server/transcription-part-store';
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB']}));
let db:D1Database;
beforeAll(async()=>{
 db=await runtime.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())
  for(const statement of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement).run();
});
afterAll(()=>runtime.dispose());
async function fixture(count=3,initialize=true){
 const id=crypto.randomUUID(),store=createTranscriptionPartStore(db);
 await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'','','mock',0,0)").bind(id,id).run();
 await db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state) VALUES(?,?,?,?,1,'encoding')").bind(id,id,id,id).run();
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES(?,'part-test',6000000)").bind(id).run();
 const parts=Array.from({length:count},(_,index)=>({index,offsetMs:index*1200000,durationMs:1200000,audioKey:`audio/${id}/part-${index}.mp3`}));
 if(initialize)await store.initialize(id,0,'a'.repeat(64),parts);
 return {id,store,parts};
}
test('duplicate claims submit once; unknown receipt blocks further paid parts',async()=>{
 const {id,store}=await fixture();
 const claims=await Promise.all([store.claim(id,0,0,id),store.claim(id,0,0,id)]);
 expect(claims.filter(Boolean)).toHaveLength(1);
 expect(claims.find(Boolean)).toMatchObject({provider_identity:id+'-part-0',receipt_key:`transcripts/${id}/${id}-part-0.provider.json`});
 await store.outcome(id,0,0,{state:'unknown',chargeUnits:null});
 expect(await store.attemptCharge(id,0)).toBeNull();
 expect(await store.claim(id,1,0,id)).toBeNull();
 await store.outcome(id,0,0,{state:'ready',chargeUnits:225,requestId:'known-response'});
 expect(await store.attemptCharge(id,0)).toBe(225);
 expect(await store.claim(id,1,0,id)).not.toBeNull();
});
test('retry reuses completed parts and rejects a stale response from the prior attempt',async()=>{
 const {id,store,parts}=await fixture();
 await store.claim(id,0,0,id);await store.outcome(id,0,0,{state:'ready',chargeUnits:101});
 await store.claim(id,1,0,id);await store.outcome(id,1,0,{state:'failed',chargeUnits:0});
 await db.prepare("UPDATE processing_budget SET state='settled',settled_units=101 WHERE id=?").bind(id).run();
 await db.prepare("UPDATE transcriptions SET paid_attempt=1 WHERE id=?").bind(id).run();
 await store.initialize(id,1,'a'.repeat(64),parts);
 const rows=await store.list(id);
 expect(rows.map(row=>[row.state,row.paid_attempt])).toEqual([['ready',0],['queued',1],['queued',1]]);
 expect(await store.claim(id,1,1,id)).toBeNull(); // Incremental reservation is required first.
 await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES(?,'part-test',4000000)").bind(id+'-attempt-1').run();
 expect(await store.claim(id,1,1,id)).toMatchObject({provider_identity:id+'-attempt-1-part-1'});
 await store.outcome(id,1,0,{state:'ready',chargeUnits:100});
 expect((await store.list(id))[1]).toMatchObject({state:'submitting',paid_attempt:1,charge_units:null});
 expect(await store.attemptCharge(id,0)).toBe(101);
});
test.each(['review','transcription'])('%s cancellation prevents new submissions and late known usage cannot restore content state',async(target)=>{
 const {id,store}=await fixture();
 await store.claim(id,0,0,id);
 await db.prepare(target==='review'?"UPDATE reviews SET lifecycle='deleting' WHERE id=?":"UPDATE transcriptions SET state='cancelled' WHERE id=?").bind(id).run();
 await store.outcome(id,0,0,{state:'ready',chargeUnits:225});
 expect((await store.list(id))[0]).toMatchObject({state:'cancelled',charge_units:225});
 expect(await store.attemptCharge(id,0)).toBe(225);
 expect(await store.claim(id,1,0,id)).toBeNull();
});
test('persisted part identity rejects changed audio or a gapped timeline',async()=>{
 const {id,store,parts}=await fixture();
 await expect(store.initialize(id,0,'b'.repeat(64),parts)).rejects.toThrow('identity changed');
 await expect(store.initialize(id,0,'a'.repeat(64),[parts[0],{...parts[1],offsetMs:1200001},parts[2]])).rejects.toThrow('timeline');
});

test('an insufficient reservation cannot authorize any part submission',async()=>{
 const {id,store}=await fixture();
 await db.prepare('UPDATE processing_budget SET reserved_units=2000000 WHERE id=?').bind(id).run();
 expect(await store.claim(id,0,0,id)).toBeNull();
 expect((await store.list(id)).every(part=>part.submitted_at===null)).toBe(true);
});

test('changing the number of persisted parts cannot leave additional rows behind',async()=>{
 const {id,store,parts}=await fixture(2);
 await expect(store.initialize(id,0,'a'.repeat(64),[...parts,{index:2,offsetMs:2400000,durationMs:1200000,audioKey:'another-part'}])).rejects.toThrow('identity changed');
 expect(await store.list(id)).toHaveLength(2);
 await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();
 await expect(store.initialize(id,0,'a'.repeat(64),parts)).rejects.toThrow('revoked');
});


test('concurrent conflicting initializers persist exactly one complete manifest',async()=>{
 const {id,parts}=await fixture(2,false);
 let arrivals=0;
 let release!:()=>void;
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 const racedDb=new Proxy(db,{get(target,key){
  if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
  return (sql:string)=>{
   const statement=target.prepare(sql);
   if(sql!=='SELECT * FROM transcription_parts WHERE transcription_id=? ORDER BY part_index')return statement;
   return new Proxy(statement,{get(target,key){
    if(key!=='bind'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
    return (...values:unknown[])=>{
     const bound=target.bind(...values);
     return new Proxy(bound,{get(target,key){
      if(key!=='all'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
      return async()=>{
       const result=await target.all();
       if(arrivals<2){arrivals++;if(arrivals===2)release();await barrier;}
       return result;
      };
     }});
    };
   }});
  };
 }});
 const store=createTranscriptionPartStore(racedDb);
 const longer=[...parts,{index:2,offsetMs:2400000,durationMs:1200000,audioKey:'third-part'}];
 const results=await Promise.allSettled([
  store.initialize(id,0,'a'.repeat(64),parts),
  store.initialize(id,0,'b'.repeat(64),longer),
 ]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const rows=await store.list(id);
 const winner=rows[0].source_sha256;
 expect(rows).toHaveLength(winner==='a'.repeat(64)?2:3);
 expect(rows.every(row=>row.source_sha256===winner)).toBe(true);
});
