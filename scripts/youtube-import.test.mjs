import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,open,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importYoutube} from './youtube-import.mjs';

test('rejects downloader injection before starting any process',async()=>{
 let calls=0;
 for(const input of [{videoId:'https://evil.test/'},{videoId:'sa41eWwM7iI',endSeconds:3601},{videoId:'sa41eWwM7iI',endSeconds:0},{videoId:'sa41eWwM7iI',url:'https://evil.test/'}])await assert.rejects(importYoutube(input,'/unused',AbortSignal.timeout(1000),async()=>{calls++;}),/Invalid/);
 assert.equal(calls,0);
});
test('retrieves a canonical single video and produces exact standard PCM cutoff',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'coach-link-test-'));let calls=0;
 try{
  const result=await importYoutube({videoId:'sa41eWwM7iI',endSeconds:1},dir,AbortSignal.timeout(15000),async(command,args)=>{
   if(calls++===0){
    assert.equal(args.at(-1),'https://www.youtube.com/watch?v=sa41eWwM7iI');
    for(const flag of ['--ignore-config','--no-plugin-dirs','--no-playlist','--max-filesize','--match-filters'])assert.ok(args.includes(flag));
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-c:a','aac',join(dir,'youtube.m4a')]);
   }else execFileSync(command,args);
  });
  const data=await readFile(result.target);assert.equal(data.length,32044);assert.equal(data.readUInt32LE(40),32000);assert.equal(data.readUInt32LE(24),16000);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects an oversized downloaded file before decoding',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'coach-link-test-'));
 try{
  await assert.rejects(importYoutube({videoId:'sa41eWwM7iI'},dir,AbortSignal.timeout(1000),async()=>{const file=await open(join(dir,'youtube.m4a'),'w');await file.truncate(256*1024*1024+1);await file.close();}),/exceeds/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
