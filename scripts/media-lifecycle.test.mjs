import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Exercise the actual entrypoint and an active HTTP request across SIGTERM.
// A fake downloader delays only retrieval; conversion still uses real FFmpeg.
test('container rollout drains an active import instead of breaking its connection',async()=>{
 const probe=createServer();probe.listen(8790,'127.0.0.1');await once(probe,'listening');await new Promise(r=>probe.close(r));
 const dir=await mkdtemp(join(tmpdir(),'coach-drain-'));
 const downloader=join(dir,'download.mjs');
 await writeFile(downloader,`#!/usr/bin/env node\nimport {execFileSync} from 'node:child_process';\nawait new Promise(r=>setTimeout(r,1200));\nexecFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','aac',process.argv[process.argv.indexOf('-o')+1]]);\n`,{mode:0o700});
 const secret='test-only-container-lifecycle-secret';
 const child=spawn(process.execPath,['media/container-entry.mjs'],{env:{...process.env,AUTH_SECRET:secret,YT_DLP_PATH:downloader},stdio:['ignore','pipe','pipe']});
 let output='';const waitFor=marker=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('Missing lifecycle marker: '+marker));},10000);
  const check=()=>{if(output.includes(marker)){cleanup();resolve();}};
  const cleanup=()=>{clearTimeout(timer);child.stdout.off('data',check);};
  child.stdout.on('data',check);check();
 });
 child.stdout.on('data',chunk=>{output+=chunk.toString();});
 const exited=once(child,'exit');
 try {
  await waitFor('Media service ready');
  const response=fetch('http://127.0.0.1:8790/operations/prepare-00000000-0000-0000-0000-000000000099',{method:'POST',headers:{authorization:'Bearer '+secret,'x-youtube-import':'1','content-type':'application/json'},body:JSON.stringify({videoId:'sa41eWwM7iI',endSeconds:1})});
  // Attach rejection immediately while waiting for the server's progress marker.
  const completed=response.then(async res=>({status:res.status,bytes:(await res.arrayBuffer()).byteLength})).catch(error=>({error}));
  await waitFor('youtube_import_started');child.kill('SIGTERM');
  const result=await completed;
  assert.equal(result.status,200,result.error?.message);
  assert.equal(result.bytes,32044);
  const [code]=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Container did not exit after drain')),5000).unref())]);
  assert.equal(code,0);
 } finally {child.kill('SIGKILL');await exited;await rm(dir,{recursive:true,force:true});}
});
