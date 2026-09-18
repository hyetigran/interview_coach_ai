import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compressChunks} from './media-adapter.mjs';

test('hour compression covers every source sample in three independently decodable provider-sized parts',{timeout:120000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'coach-transcription-chunks-'));
 try {
  const source=join(directory,'source.wav');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=3600','-ac','1',source],{timeout:30000});
  const result=await compressChunks(source,directory,AbortSignal.timeout(75000));
  assert.equal(result.chunks.length,3);
  assert.deepEqual(result.chunks.map(({offsetMs,durationMs})=>({offsetMs,durationMs})),[0,1200000,2400000].map(offsetMs=>({offsetMs,durationMs:1200000})));
  let decodedBytes=0;
  for(const chunk of result.chunks){
   const path=join(directory,`part-${chunk.index}.mp3`),decoded=join(directory,`part-${chunk.index}.pcm`);
   assert.equal((await stat(path)).size,chunk.bytes);
   execFileSync('ffmpeg',['-v','error','-i',path,'-f','s16le','-ac','1','-ar','16000',decoded],{timeout:30000});
   decodedBytes+=(await stat(decoded)).size;
  }
  assert.equal(decodedBytes,3600*32000);
  const bundle=await readFile(result.target),headerLength=bundle.readUInt32BE(0);
  assert.deepEqual(JSON.parse(bundle.subarray(4,4+headerLength).toString()),{version:1,chunks:result.chunks});
  assert.equal(bundle.length,4+headerLength+result.chunks.reduce((sum,chunk)=>sum+chunk.bytes,0));
  assert.ok(bundle.length<=15000000);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('private compression returns the requested versioned bundle',async()=>{
 const {mediaServer}=await import('./media-adapter.mjs');
 const server=mediaServer('chunk-test-secret');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const directory=await mkdtemp(join(tmpdir(),'coach-chunk-http-'));
 try{
  const source=join(directory,'source.wav');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-ar','16000','-ac','1',source]);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/compression/transcript-prepare-00000000-0000-0000-0000-000000000000`,{method:'POST',headers:{authorization:'Bearer chunk-test-secret','x-transcription-parts':'1'},body:await readFile(source)});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/vnd.interview-coach.transcription-parts');
  const body=Buffer.from(await response.arrayBuffer()),header=JSON.parse(body.subarray(4,4+body.readUInt32BE(0)).toString());
  assert.equal(header.version,1);assert.equal(header.chunks.length,1);assert.equal(header.chunks[0].durationMs,2000);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
