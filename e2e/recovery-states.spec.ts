import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {registerInvited} from './register-invited';
import {testOrigin as origin,invitationFlags} from './test-target';

test('blocked recovery explains the next step without offering paid retries',async({page,context})=>{
  test.setTimeout(180000);
  const email=`recovery-states-${randomUUID()}@example.com`;
  const invitation=execFileSync('node',['scripts/invite.mjs',email,...invitationFlags],{encoding:'utf8'}).trim().split('\n').at(-1)!;
  expect((await registerInvited(context.request,{headers:{origin,'x-invitation-token':invitation},data:{name:'Recovery States',email,password:randomUUID()+randomUUID()}})).ok()).toBeTruthy();
  const creation=await context.request.post('/api/reviews',{headers:{origin},data:{title:'Recovery status fixture',role:'Engineer',origin:'mock'}});
  expect(creation.ok()).toBeTruthy();
  const {id}=await creation.json(),endpoint='/api/reviews/'+id;
  const question='Fixture question?',answer='Fixture evidence remains accessible.';
  const utterances=[{id:'q',speaker:'A',text:question,startMs:0,endMs:1000,overlap:false},{id:'a',speaker:'B',text:answer,startMs:1000,endMs:2000,overlap:false}];
  const evidence=utterances.map((u,position)=>({transcriptId:'fixture',utteranceId:u.id,quote:u.text,start:0,end:u.text.length,startMs:u.startMs,endMs:u.endMs,position,uncertain:false}));
  const groups=[{id:'group',question:[evidence[0]],answers:[evidence[1]],parentId:null,uncertain:false}];
  const conditions=[
    {state:'budget_blocked',reason:'The remaining processing allowance cannot cover this retry.'},
    {state:'unknown',reason:'A provider charge is unresolved. Its reservation stays held until reconciliation.'},
    {state:'reconciliation_exhausted',reason:'Recovery reached its attempt limit. Review the retained evidence.'},
  ];
  let stage='preparation',condition=conditions[0],writes=0;
  // Controlled API responses verify presentation only. Server admission and
  // receipt/budget invariants are exercised by the database integration tests.
  await page.route(`**${endpoint}/*`,async route=>{
    const path=new URL(route.request().url()).pathname.slice(endpoint.length);
    if(route.request().method()!=='GET'){writes++;await route.fulfill({status:409,json:{error:'Fixture must not submit work.'}});return;}
    const retry={canRetry:false,reason:condition.reason,maximumUnits:450000,attempt:2};
    const responses:Record<string,unknown>={
      '/media':{upload:{id:'fixture',name:'fixture.wav',state:'admitted',parts:[]},admitted:1,reserved:0,allowance:3},
      '/processing':{id:'prepared',state:stage==='preparation'?'failed':'ready',error:stage==='preparation'?condition.reason:null,result:{durationMs:2000},retry:{...retry,waiting:false}},
      '/transcript':{id:'fixture',revision:1,state:stage==='transcription'?condition.state:'ready',error:stage==='transcription'?condition.reason:null,retry,transcript:{version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'fixture',durationMs:2000,utterances}},
      '/speakers':{id:'confirmed',transcriptId:'fixture',speakers:['B'],state:'confirmed'},
      '/threads':{id:'grouping',transcriptId:'fixture',version:1,state:stage==='grouping'?'partial':'ready',total:2,completed:1,groups,errors:stage==='grouping'?[{section:2,error:condition.reason}]:[],retry:{...retry,runId:'grouping',version:1,sections:[2]}},
      '/coaching':{state:'partial',jobs:[{id:'coaching',threadId:'group',state:condition.state,error:condition.reason,result:null,retry:{...retry,jobId:'coaching',reuseDraft:false}}]},
    };
    if(path in responses){await route.fulfill({json:responses[path]});return;}
    if(path==='/audio'){await route.fulfill({status:404});return;}
    await route.continue();
  });
  try{
    for(stage of ['preparation','transcription','grouping','coaching']){
      for(condition of conditions){
        await test.step(`${stage}: ${condition.state}`,async()=>{
          await page.goto('/reviews/'+id);
          if(stage==='coaching'){
            const summary=page.locator('summary').filter({hasText:question});
            await summary.focus();await summary.press('Enter');
          }
          await expect(page.getByText(condition.reason,{exact:true}).first()).toBeVisible();
          await expect(page.getByRole('button',{name:/^(Retry preparation|Retry transcription|Publish saved transcript|Retry question grouping|Publish saved grouping|Retry coaching|Retry support check|Publish saved coaching)$/})).toHaveCount(0);
          if(stage==='grouping'||stage==='coaching')await expect(page.locator('p').filter({hasText:answer}).first()).toBeVisible();
          expect(writes).toBe(0);
        });
      }
    }
  }finally{await context.request.delete(endpoint,{headers:{origin},data:{}});}
});
