import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveGroups } from '../lib/threads';
import type { Transcript } from '../lib/transcript';
test('question threads open by keyboard and retain missing answers and uncertain follow-ups',async({page,context})=>{
  const email=`threads-${randomUUID()}@example.com`;
  const invitation=execFileSync('node',['scripts/invite.mjs',email],{encoding:'utf8'}).trim().split('\n').at(-1)!;
  const origin='http://127.0.0.1:3000';
  expect((await context.request.post('/api/auth/sign-up/email',{headers:{origin,'x-invitation-token':invitation},data:{name:'Threads Test',email,password:randomUUID()+randomUUID()}})).ok()).toBeTruthy();
  const review=await (await context.request.post('/api/reviews',{headers:{origin},data:{title:'Question navigation',role:'Engineer',origin:'mock'}})).json();
  const transcript:Transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:9000,utterances:[
    {id:'q',speaker:'A',text:'What did you build?',startMs:0,endMs:2000,overlap:false},
    {id:'a',speaker:'B',text:'I built a service.',startMs:2000,endMs:4000,overlap:false},
    {id:'f',speaker:'C',text:'What would you change?',startMs:4000,endMs:6000,overlap:true},
  ]};
  const groups=resolveGroups({groups:[{question:[{utteranceId:'q',quote:'What did you build?'}],answers:[{utteranceId:'a',quote:'I built a service.'}],parent:null,uncertain:false},{question:[{utteranceId:'f',quote:'What would you change?'}],answers:[],parent:{utteranceId:'q',quote:'What did you build?'},uncertain:true}]},transcript,'t',['B']);
  // API fixtures isolate keyboard behavior; D1/R2 and the real provider have separate integration coverage.
  const responses:Record<string,unknown>={media:{upload:{id:'u',state:'admitted',name:'test.wav',parts:[]},admitted:1,reserved:0,allowance:3},processing:{state:'ready',result:{durationMs:9000}},transcript:{id:'t',state:'ready',transcript},speakers:{id:'s',transcriptId:'t',speakers:['B'],state:'confirmed'},threads:{state:'partial',total:2,completed:1,errors:[{section:2,error:'Section unavailable.'}],groups}};
  for(const [endpoint,data] of Object.entries(responses))await page.route(`**/api/reviews/${review.id}/${endpoint}`,route=>route.fulfill({json:data}));
  await page.goto(`/reviews/${review.id}`);
  const root=page.locator('summary').filter({hasText:'What did you build?'});await root.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Original answer',exact:true})).toBeVisible();
  const follow=page.locator('summary').filter({hasText:'What would you change?'});await follow.focus();await page.keyboard.press('Enter');
  await expect(page.getByText('No supported answer was linked to this question.')).toBeVisible();
  await expect(page.getByText('This association is uncertain. Compare it with the transcript and audio.')).toBeVisible();
  const play=page.getByRole('button',{name:'Play passage at 0:04',exact:true});await play.focus();await page.keyboard.press('Enter');
  await expect(page.getByText(/Some sections could not be grouped/)).toBeVisible();
  await context.request.delete(`/api/reviews/${review.id}`,{headers:{origin},data:{}});
});
