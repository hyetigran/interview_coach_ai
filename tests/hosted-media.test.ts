import {afterAll, beforeAll, expect, test, vi} from 'vitest';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {reserveMediaAttempt} from '../server/media-admission';
import {noUnresolvedProviders} from '../server/historical-billing';
import {mediaServiceRequest} from '../server/media-service';

vi.mock('@cloudflare/containers', () => ({Container: class {
  constructor(public ctx: unknown, public env: unknown) {}
  startAndWaitForPorts = vi.fn(async () => {});
  schedule = vi.fn(async () => {});
  destroy = vi.fn(async () => {});
}}));
import {MediaProcessor} from '../media/worker';
const runtime = new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB']}));
let db: D1Database;
beforeAll(async () => {
  db = await runtime.getD1Database('DB') as unknown as D1Database;
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) for (const statement of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint')) if(statement.trim()) await db.prepare(statement).run();
  for (let n=1;n<=7;n++) {
    const id=path(n).slice('/operations/'.length);
    await db.prepare("INSERT INTO reviews(id,owner_id,title,role,origin,created_at,updated_at) VALUES(?,?,'Test','Engineer','mock',0,0)").bind(id,'owner-'+n).run();
    await db.prepare("INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,deadline,created_at) VALUES(?,?,?,?,'running',?,0)").bind(id,id,'owner-'+n,id,Date.now()+300000).run();
  }
});
afterAll(() => runtime.dispose());
function processor() {
  const storage = new Map<string, unknown>();
  let queue = Promise.resolve();
  const forward = vi.fn(async () => new Response('audio'));
  const ctx = {
    storage:{get:async (key:string)=>storage.get(key),put:async (key:string,value:unknown)=>{storage.set(key,value);}},
    blockConcurrencyWhile: (operation:()=>Promise<unknown>) => {const next=queue.then(operation);queue=next.then(()=>{},()=>{});return next;},
    container:{getTcpPort:()=>({fetch:forward})},
  };
  return {service:new MediaProcessor(ctx as unknown as ConstructorParameters<typeof MediaProcessor>[0],{DB:db}),forward};
}
const path = (id:number) => `/operations/prepare-00000000-0000-0000-0000-${String(id).padStart(12,'0')}`;
const request = (id:number,method:'POST'|'DELETE'='POST') => new Request('https://media.internal'+path(id), {method,body:method==='POST'?'video':undefined});
test('a concurrent duplicate starts only one paid attempt and leaves its unknown charge reserved',async()=>{
  const {service,forward}=processor();
  const responses=await Promise.all([service.fetch(request(1)),service.fetch(request(1))]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  await Promise.all(responses.map(r=>r.text()));
  expect(service.startAndWaitForPorts).toHaveBeenCalledTimes(1);
  expect(forward).toHaveBeenCalledTimes(1);
  expect(service.destroy).toHaveBeenCalled();
  expect(await db.prepare('SELECT state,reserved_units,settled_units FROM processing_budget').first()).toEqual({state:'reserved',reserved_units:100000,settled_units:null});
  expect((await service.fetch(request(1))).status).toBe(409);
});
test('cancellation before execution prevents any later paid start',async()=>{
  const {service}=processor();
  expect((await service.fetch(request(2,'DELETE'))).status).toBe(204);
  expect((await service.fetch(request(2))).status).toBe(409);
  expect(service.startAndWaitForPorts).not.toHaveBeenCalled();
});
test('cancelled output and expired lifetime destroy compute',async()=>{
  const {service}=processor();
  const response=await service.fetch(request(3));
  await response.body!.cancel();
  expect(service.destroy).toHaveBeenCalled();
  await service.expire();
  expect(service.destroy).toHaveBeenCalledTimes(2);
});
test('private endpoints reject browser origins and unsupported routes',async()=>{
  const {service}=processor();
  expect((await service.fetch(new Request('https://media.internal/health'))).status).toBe(404);
  expect((await service.fetch(new Request('https://media.internal'+path(4),{method:'POST',headers:{origin:'https://evil.example'}}))).status).toBe(404);
  expect(service.startAndWaitForPorts).not.toHaveBeenCalled();
});
test('insufficient shared allowance does not start compute',async()=>{
  await db.prepare("INSERT INTO processing_budget(id,operation,reserved_units) VALUES('other','other',49800000)").run();
  const {service}=processor();
  expect((await service.fetch(request(5))).status).toBe(402);
  expect(service.startAndWaitForPorts).not.toHaveBeenCalled();
});
test('hosted requests use the private binding and never leak local authentication',async()=>{
  const forward=vi.fn(async (request:Request)=>{expect(request.headers.has('authorization')).toBe(false);return new Response('audio');});
  const namespace={idFromName:vi.fn((name:string)=>name),get:()=>({fetch:forward})};
  const network=vi.fn();
  const response=await mediaServiceRequest({MEDIA_PROCESSOR:namespace as unknown as DurableObjectNamespace,AUTH_SECRET:'local-secret'},path(6),{method:'POST',body:'video'},network);
  expect(await response.text()).toBe('audio');
  expect(namespace.idFromName).toHaveBeenCalledWith(path(6));
  expect(network).not.toHaveBeenCalled();
});

test('late dispatch after deletion is denied even before cancellation reaches the container',async()=>{
  const id=path(7).slice('/operations/'.length);
  await db.prepare("DELETE FROM processing_budget WHERE id='other'").run();
  await db.prepare("UPDATE reviews SET lifecycle='deleting' WHERE id=?").bind(id).run();
  const {service}=processor();
  expect((await service.fetch(request(7))).status).toBe(402);
  expect(service.startAndWaitForPorts).not.toHaveBeenCalled();
});
test('a lost media outcome blocks new attempt identities and account admission',async()=>{
  const id=path(1).slice('/operations/'.length);
  await db.prepare('UPDATE processing_jobs SET attempt=1 WHERE id=?').bind(id).run();
  expect(await reserveMediaAttempt(db,path(1)+'-prepare-attempt-1')).toBe(false);
  expect(await db.prepare(`SELECT 1 AS allowed WHERE ${noUnresolvedProviders("'owner-1'")}`).first()).toBeNull();
});
