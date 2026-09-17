import {afterAll, beforeAll, expect, test, vi} from 'vitest';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {readFileSync, readdirSync} from 'node:fs';
import {createRuntimeProcessing} from '../server/processing';

const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB'],r2Buckets:['MEDIA']}));
let db:D1Database, media:R2Bucket;
beforeAll(async()=>{
  db=await runtime.getD1Database('DB') as unknown as D1Database;
  media=await runtime.getR2Bucket('MEDIA') as unknown as R2Bucket;
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())
    for(const statement of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint'))
      if(statement.trim())await db.prepare(statement).run();
});
afterAll(()=>runtime.dispose());

test.each([
  ['local missing instance','instance.not_found','cancelled'],
  ['local missing instance detail','instance.not_found: Instance not found','cancelled'],
  ['deployed missing instance','(instance.not_found) Instance not found','cancelled'],
  ['service failure','(instance.internal_error) Service unavailable','cancel_pending'],
  ['different error code','instance.not_found_elsewhere','cancel_pending'],
  ['embedded error text','Request failed while checking instance.not_found','cancel_pending'],
])('%s retains the correct cancellation state',async(_label,message,expected)=>{
  const id=crypto.randomUUID();
  await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,lifecycle,created_at,updated_at) VALUES(?,?,'','','mock','deleting',0,0)").bind(id,id).run();
  await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,dispatch_state,created_at) VALUES(?,?,?,?,'cancelled','cancel_pending',0)").bind(id,id,id,id).run();
  const workflow={get:vi.fn(async(target:string)=>{throw new Error(target===id?message:'(instance.internal_error) Still unavailable');}),createBatch:vi.fn()};
  await createRuntimeProcessing({DB:db,MEDIA:media,PROCESSING:workflow as unknown as Workflow<{jobId:string;preparationAttempt?:number}>}).reconcile();
  expect(await db.prepare('SELECT dispatch_state FROM processing_jobs WHERE id=?').bind(id).first()).toEqual({dispatch_state:expected});
});
