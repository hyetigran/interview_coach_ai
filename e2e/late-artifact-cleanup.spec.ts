import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerInvited} from './register-invited';
import {testOrigin as origin, invitationFlags, databaseFlags, storageFlags, mediaBucket} from './test-target';

// Inject late storage writes after deletion; this does not simulate a live provider call.
test('deleted upload rejects its capability and scheduled cleanup removes late artifacts', async ({context}) => {
  test.skip(!process.env.E2E_PREVIEW_ORIGIN, 'Requires the deployed scheduled cleanup Worker.');
  test.setTimeout(300000);
  const email=`late-cleanup-${randomUUID()}@example.com`;
  const invitation=execFileSync('node',['scripts/invite.mjs',email,...invitationFlags],{encoding:'utf8'}).trim().split('\n').at(-1)!;
  const registration=await registerInvited(context.request,{headers:{origin,'x-invitation-token':invitation},data:{name:'Synthetic Cleanup Test',email,password:randomUUID()+randomUUID()}});
  expect(registration.ok()).toBeTruthy();
  const creation=await context.request.post('/api/reviews',{headers:{origin},data:{title:'Late artifact cleanup',role:'Engineer',origin:'mock'}});
  expect(creation.ok()).toBeTruthy();
  const review=await creation.json(), endpoint='/api/reviews/'+review.id;
  const folder=mkdtempSync(join(tmpdir(),'coach-late-cleanup-'));
  try {
    const initiation=await context.request.post(endpoint+'/media',{headers:{origin},data:{name:'unfinished.wav',size:64044,actionId:randomUUID()}});
    expect(initiation.ok()).toBeTruthy();
    const upload=await initiation.json();
    const part=endpoint+`/uploads/${upload.id}/parts/1`;
    const signed=await context.request.post(part+'/sign',{headers:{origin},data:{}});
    expect(signed.ok()).toBeTruthy();const {token}=await signed.json();
    expect([202,204]).toContain((await context.request.delete(endpoint,{headers:{origin},data:{}})).status());
    expect((await context.request.put(part,{headers:{origin,'content-type':'application/octet-stream','x-part-capability':token},data:Buffer.alloc(64044)})).status()).toBe(404);
    expect((await context.request.post(endpoint+`/uploads/${upload.id}/complete`,{headers:{origin},data:{}})).status()).toBe(404);
    const keys=[`originals/${upload.id}`,`audio/${upload.id}/late-attempt.wav`,
      `transcripts/${review.id}/transcript-prepare-${upload.id}.json`,
      `transcripts/${review.id}/transcript-prepare-${upload.id}.provider.json`];
    const file=join(folder,'synthetic-artifact');writeFileSync(file,'Synthetic late artifact; no recording or provider output.',{mode:0o600});
    for(const key of keys)execFileSync('pnpm',['exec','wrangler','r2','object','put',mediaBucket+'/'+key,...storageFlags,'--file',file],{stdio:'pipe',timeout:60000});
    // Read each object back successfully: an arbitrary CLI failure cannot prove absence.
    for(const [index,key] of keys.entries())execFileSync('pnpm',['exec','wrangler','r2','object','get',mediaBucket+'/'+key,...storageFlags,'--file',join(folder,'read-'+index)],{stdio:'pipe',timeout:60000});
    for(const route of ['', '/audio','/transcript','/processing'])expect((await context.request.get(endpoint+route)).status()).toBe(404);
    const writtenAt=Date.now();
    const query=`SELECT cleaned_at FROM uploads WHERE id='${upload.id}' AND state='cleanup'`;
    await expect.poll(()=>{
      const rows=JSON.parse(execFileSync('pnpm',['exec','wrangler','d1','execute','DB',...databaseFlags,'--json','--command',query],{encoding:'utf8',timeout:60000}));
      return rows[0].results[0]?.cleaned_at??0;
    },{timeout:150000,intervals:[10000]}).toBeGreaterThan(writtenAt);
    for(const key of keys){
      let failure='';
      try{execFileSync('pnpm',['exec','wrangler','r2','object','get',mediaBucket+'/'+key,...storageFlags,'--file',join(folder,'unexpected')],{stdio:'pipe',timeout:60000});}
      catch(error){if(error instanceof Error&&'stderr' in error)failure=String(error.stderr);else throw error;}
      expect(failure).toMatch(/specified key does not exist|object does not exist|NoSuchKey/i);
    }
    expect((await(await context.request.get(endpoint+'/deletion')).json()).cleanupPending).toBe(false);
    expect((await context.request.post(endpoint+'/processing',{headers:{origin},data:{actionId:randomUUID()}})).status()).toBe(404);
  } finally {
    await context.request.delete(endpoint,{headers:{origin},data:{},timeout:10000}).catch(()=>{});
    rmSync(folder,{recursive:true,force:true});
  }
});
