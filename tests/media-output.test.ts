import {afterAll, expect, test} from 'vitest';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {mediaOutputForStorage} from '../server/media-output';
const runtime = new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-08',r2Buckets:['MEDIA'],script:`
const mediaOutputForStorage = ${mediaOutputForStorage.toString()};
export default {async fetch(request,env) {
 const mode=new URL(request.url).pathname;
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('audio'));c.close();}});
 const response=new Response(body,{headers:{'content-length':mode==='/short'?'6':mode==='/large'?'999999999':'5'}});
 try { const object=await env.MEDIA.put('result',mode==='/unframed'?response.body:mediaOutputForStorage(response));return Response.json({size:object.size,text:await (await env.MEDIA.get('result')).text()}); }
 catch(error) {return Response.json({error:error.message},{status:422});}
}};`}));
afterAll(()=>runtime.dispose());
test('a monitored media stream can be stored in R2 without buffering the recording',async()=>{
 const result=await runtime.dispatchFetch('http://test/valid');
 expect(result.status,await result.clone().text()).toBe(200);expect(await result.json()).toEqual({size:5,text:'audio'});
});
test('truncated output fails instead of publishing an incomplete recording',async()=>{
 const result=await runtime.dispatchFetch('http://test/short');expect(result.status,await result.clone().text()).toBe(422);
});
test('an excessive declared size is rejected before storage',async()=>{
 const result=await runtime.dispatchFetch('http://test/large');expect(result.status,await result.clone().text()).toBe(422);
});

test('unframed media output reproduces the hosted R2 rejection',async()=>{
 const result=await runtime.dispatchFetch('http://test/unframed');expect(result.status,await result.clone().text()).toBe(422);
 expect(await result.json()).toEqual({error:expect.stringContaining('known length')});
});
