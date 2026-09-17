import {testOrigin,invitationFlags,databaseFlags,storageFlags,mediaBucket} from './test-target';
import { registerInvited } from './register-invited';
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('candidate retries an expired voice confirmation without retranscribing',async({page,context})=>{
 test.setTimeout(90000);const origin=testOrigin,email=`correction-${randomUUID()}@example.com`;
 const invitation=execFileSync('node',['scripts/invite.mjs',email,...invitationFlags],{encoding:'utf8'}).trim().split('\n').at(-1)!;
 const signup=await registerInvited(context.request,{headers:{origin,'x-invitation-token':invitation},data:{name:'Correction Test',email,password:randomUUID()+randomUUID()}});expect(signup.ok()).toBeTruthy();const owner=(await signup.json()).user.id;
 const review=await (await context.request.post('/api/reviews',{headers:{origin},data:{title:'Confirmation recovery test',role:'Engineer',origin:'mock'}})).json();const endpoint=`/api/reviews/${review.id}`,id=randomUUID(),key=`transcripts/${review.id}/${id}.json`;
 try{
 const transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'fixture',durationMs:2000,utterances:[{id:'q',speaker:'B',text:'What did you build?',startMs:0,endMs:1000,overlap:false},{id:'a',speaker:'B',text:'I built a repeated repeated café.',startMs:1000,endMs:2000,overlap:false}]};
 const confirmation=randomUUID();
 const folder=mkdtempSync(join(tmpdir(),'correction-fixture-'));
 try{const doc=join(folder,'transcript.json'),sql=join(folder,'seed.sql');writeFileSync(doc,JSON.stringify(transcript),{mode:0o600});execFileSync('pnpm',['exec','wrangler','r2','object','put',`${mediaBucket}/${key}`,...storageFlags,'--file',doc],{stdio:'pipe'});writeFileSync(sql,`INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key) VALUES('${id}','${review.id}','${owner}','${id}',1,'ready','${key}'); INSERT INTO speaker_confirmations(id,review_id,owner_id,transcript_id,speakers,revision,state,dispatch_state,confirmed_at,deadline) VALUES('${confirmation}','${review.id}','${owner}','${id}','["B"]',1,'failed','sent',0,0);`,{mode:0o600});execFileSync('pnpm',['exec','wrangler','d1','execute','DB',...databaseFlags,'--file',sql],{stdio:'pipe'});}finally{rmSync(folder,{recursive:true,force:true});}
 await page.route(`**${endpoint}/media`,route=>route.fulfill({json:{upload:{id:'fixture',state:'admitted',name:'test.wav',parts:[]},admitted:1,reserved:0,allowance:3}}));await page.route(`**${endpoint}/processing`,route=>route.fulfill({json:{state:'ready',result:{durationMs:2000}}}));
 await page.goto(`/reviews/${review.id}`);const retry=page.getByRole('button',{name:'Retry saved voice confirmation',exact:true});await expect(retry).toBeVisible();await retry.focus();await retry.press('Enter');await expect(retry).toHaveCount(0);
 await expect(page.getByRole('status').filter({hasText:/Your selection is saved. Waiting to continue|Your voice is confirmed/})).toBeVisible();
 const current=await (await context.request.get(endpoint+'/speakers')).json();expect(current.id).not.toBe(confirmation);expect(current.transcriptId).toBe(id);expect(current.speakers).toEqual(['B']);
 await page.reload();await expect(page.getByRole('button',{name:'Retry saved voice confirmation',exact:true})).toHaveCount(0);expect((await (await context.request.get(endpoint+'/transcript')).json()).id).toBe(id);
 await context.request.delete(endpoint,{headers:{origin},data:{}});expect((await context.request.patch(endpoint+'/speakers',{headers:{origin},data:{actionId:randomUUID(),targetId:current.id}})).status()).toBe(404);
 }finally{await context.request.delete(endpoint,{headers:{origin},data:{},timeout:10000}).catch(()=>{});}
});
