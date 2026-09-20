import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerInvited} from './register-invited';
import {testOrigin, invitationFlags, databaseFlags, storageFlags, mediaBucket} from './test-target';

const sql = (value:string) => "'" + value.replaceAll("'", "''") + "'";

for (const stage of ['preparation', 'publication'] as const) {
  test(`candidate recovers ${stage} from saved artifacts without new paid work`, async ({page, context}) => {
    test.setTimeout(240000);
    const origin = testOrigin;
    const email = `stage-recovery-${randomUUID()}@example.com`;
    const invitation = execFileSync('node', ['scripts/invite.mjs', email, ...invitationFlags], {encoding:'utf8'}).trim().split('\n').at(-1)!;
    const signup = await registerInvited(context.request, {headers:{origin, 'x-invitation-token':invitation},
      data:{name:'Synthetic Recovery Test', email, password:randomUUID()+randomUUID()}});
    expect(signup.ok()).toBeTruthy();
    const owner = (await signup.json()).user.id;
    const created = await context.request.post('/api/reviews', {headers:{origin}, data:{title:`Saved ${stage} recovery`, role:'Engineer', origin:'mock'}});
    expect(created.ok()).toBeTruthy();
    const review = await created.json(), endpoint = `/api/reviews/${review.id}`;
    const folder = mkdtempSync(join(tmpdir(), 'coach-stage-recovery-'));
    const upload = randomUUID(), job = 'prepare-'+upload, transcriptId = 'transcript-'+job;
    const sourceKey = 'originals/'+upload, transcriptKey = `transcripts/${review.id}/${transcriptId}.json`;
    try {
      const wave = Buffer.alloc(64044);
      wave.write('RIFF'); wave.writeUInt32LE(wave.length-8,4); wave.write('WAVEfmt ',8);
      wave.writeUInt32LE(16,16); wave.writeUInt16LE(1,20); wave.writeUInt16LE(1,22);
      wave.writeUInt32LE(16000,24); wave.writeUInt32LE(32000,28); wave.writeUInt16LE(2,32); wave.writeUInt16LE(16,34);
      wave.write('data',36); wave.writeUInt32LE(wave.length-44,40);
      const hash = createHash('sha256').update(wave).digest('hex');
      const prepared = {sourceKey,sourceSha256:hash,sourceBytes:wave.length,sha256:hash,bytes:wave.length,durationMs:2000,channels:1,sampleRate:16000,audioKey:sourceKey,audioBytes:wave.length,originalTimeOffsetMs:0};
      const text = 'This is a synthetic saved-transcript recovery fixture.';
      const transcript = {version:1,model:'gpt-4o-transcribe-diarize',audioSha256:hash,durationMs:2000,
        utterances:[{id:transcriptId+':0',speaker:'A',text,startMs:0,endMs:2000,overlap:false}]};
      // These are fixture receipts and a zero-cost fixture ledger, not actual provider usage.
      const receipt = {response:JSON.stringify({duration:2,segments:[{speaker:'A',text,start:0,end:2}],usage:{type:'tokens',input_tokens:0,output_tokens:0}})};
      const statements = [
        `INSERT INTO uploads(id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at,admitted_at) VALUES(${sql(upload)},${sql(owner)},${sql(review.id)},${sql(randomUUID())},'recovery.wav',${wave.length},'admitted',${sql(sourceKey)},${Date.now()+86400000},${Date.now()},${Date.now()});`,
        `INSERT INTO processing_jobs(id,review_id,owner_id,upload_id,state,dispatch_state,created_at,error,result) VALUES(${sql(job)},${sql(review.id)},${sql(owner)},${sql(upload)},${sql(stage==='preparation'?'failed':'ready')},'cancelled',${Date.now()},'Synthetic interrupted preparation',${stage==='preparation'?'NULL':sql(JSON.stringify(prepared))});`,
        `INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key,error,publication_attempts) VALUES(${sql(transcriptId)},${sql(review.id)},${sql(owner)},${sql(job)},1,${sql(stage==='preparation'?'ready':'reconciliation_exhausted')},${stage==='preparation'?sql(transcriptKey):'NULL'},'Synthetic exhausted publication',${stage==='preparation'?0:3});`,
        `INSERT INTO processing_budget(id,operation,reserved_units,state,settled_units) VALUES(${sql(transcriptId)},'synthetic-recovery-fixture',0,'settled',0);`,
      ];
      const seed = join(folder,'seed.sql'); writeFileSync(seed,statements.join('\n'),{mode:0o600});
      execFileSync('pnpm',['exec','wrangler','d1','execute','DB',...databaseFlags,'--file',seed],{stdio:'pipe',timeout:60000});
      const objects = [
        {key:sourceKey,body:wave,type:'audio/wav'},
        {key:stage==='preparation'?transcriptKey:`transcripts/${review.id}/${transcriptId}.provider.json`,body:Buffer.from(JSON.stringify(stage==='preparation'?transcript:receipt)),type:'application/json'},
      ];
      for (const [index, object] of objects.entries()) {
        const file=join(folder,'object-'+index);writeFileSync(file,object.body,{mode:0o600});
        execFileSync('pnpm',['exec','wrangler','r2','object','put',`${mediaBucket}/${object.key}`,...storageFlags,'--file',file,'--content-type',object.type],{stdio:'pipe',timeout:60000});
      }
      await page.goto(`/reviews/${review.id}`);
      const target=endpoint+(stage==='preparation'?'/processing':'/recovery');
      const button=page.getByRole('button',{name:stage==='preparation'?'Retry preparation':'Publish saved transcript',exact:true});
      await expect(button).toBeVisible();
      const submitted=page.waitForRequest(request=>new URL(request.url()).pathname===target&&request.method()==='POST');
      const accepted=page.waitForResponse(response=>new URL(response.url()).pathname===target&&response.request().method()==='POST');
      await button.focus();await button.press('Enter');
      const action=(await submitted).postDataJSON();
      expect((await accepted).status()).toBe(202);
      await page.close();
      page=await context.newPage();
      await page.goto('/reviews');await page.goto(`/reviews/${review.id}`);
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/transcript')).json()).state,{timeout:100000}).toBe('ready');
      await expect(page.getByText('Recording prepared',{exact:true})).toBeVisible({timeout:100000});
      await expect(page.locator('p').filter({hasText:text})).toBeVisible();
      const current=await(await context.request.get(endpoint+'/transcript')).json();
      expect(current.id).toBe(transcriptId);expect(current.transcript).toEqual(transcript);
      const preparation=await(await context.request.get(endpoint+'/processing')).json();
      expect(preparation.id).toBe(job);expect(preparation.retry.attempt).toBe(stage==='preparation'?1:0);
      const duplicates=await Promise.all([1,2].map(()=>context.request.post(target,{headers:{origin},data:action})));
      for(const response of duplicates)expect(response.status()).toBe(202);
      const ledger=JSON.parse(execFileSync('pnpm',['exec','wrangler','d1','execute','DB',...databaseFlags,'--json','--command',`SELECT id,operation,reserved_units,state,settled_units FROM processing_budget WHERE id LIKE ${sql('%'+upload+'%')}`],{encoding:'utf8',timeout:60000}));
      expect(ledger[0].results).toEqual([{id:transcriptId,operation:'synthetic-recovery-fixture',reserved_units:0,state:'settled',settled_units:0}]);
      const attempts=JSON.parse(execFileSync('pnpm',['exec','wrangler','d1','execute','DB',...databaseFlags,'--json','--command',`SELECT paid_attempt,publication_retries FROM transcriptions WHERE id=${sql(transcriptId)}`],{encoding:'utf8',timeout:60000}));
      expect(attempts[0].results).toEqual([{paid_attempt:0,publication_retries:stage==='publication'?1:0}]);
      await page.reload();await expect(page.locator('p').filter({hasText:text})).toBeVisible();
      expect([202,204]).toContain((await context.request.delete(endpoint,{headers:{origin},data:{}})).status());
      expect((await context.request.post(target,{headers:{origin},data:action})).status()).toBe(404);
      expect((await context.request.get(endpoint+'/audio')).status()).toBe(404);
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/deletion')).json()).cleanupPending,{timeout:60000,intervals:[1000,5000]}).toBe(false);
    } finally {
      await context.request.delete(endpoint,{headers:{origin},data:{},timeout:10000}).catch(()=>{});
      rmSync(folder,{recursive:true,force:true});
    }
  });
}
