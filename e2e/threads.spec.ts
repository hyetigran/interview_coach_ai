import { registerInvited } from './register-invited';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { coachingSources, resolveCoaching } from '../lib/coaching';
import { resolveGroups } from '../lib/threads';
import type { Transcript } from '../lib/transcript';
test('question threads open by keyboard and retain missing answers and uncertain follow-ups',async({page,context})=>{
  const email=`threads-${randomUUID()}@example.com`;
  const invitation=execFileSync('node',['scripts/invite.mjs',email],{encoding:'utf8'}).trim().split('\n').at(-1)!;
  const origin='http://127.0.0.1:3000';
  expect((await registerInvited(context.request,{headers:{origin,'x-invitation-token':invitation},data:{name:'Threads Test',email,password:randomUUID()+randomUUID()}})).ok()).toBeTruthy();
  const review=await (await context.request.post('/api/reviews',{headers:{origin},data:{title:'Question navigation',role:'Engineer',origin:'mock'}})).json();
  const transcript:Transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:9000,utterances:[
    {id:'q',speaker:'A',text:'What did you build?',startMs:0,endMs:2000,overlap:false},
    {id:'a',speaker:'B',text:'I built a service.',startMs:2000,endMs:4000,overlap:false},
    {id:'f',speaker:'C',text:'What would you change?',startMs:4000,endMs:6000,overlap:true},
  ]};
  const groups=resolveGroups({groups:[{question:[{utteranceId:'q',quote:'What did you build?'}],answers:[{utteranceId:'a',quote:'I built a service.'}],parent:null,uncertain:false},{question:[{utteranceId:'f',quote:'What would you change?'}],answers:[],parent:{utteranceId:'q',quote:'What did you build?'},uncertain:true}]},transcript,'t',['B']);
  const sources=coachingSources(groups[0],groups);
  // Use a clear standalone source for the proposal fixture; the follow-up's overlap
  // remains a separate UI uncertainty example.
  const advice=resolveCoaching({outcome:'preserve',questionType:'past_project',rationale:'Keep your concrete description.',dimensions:['specificity'],segments:[{kind:'assertion',text:'I built a service.',citations:[{sourceId:sources.answers[0].sourceId,quote:'I built a service.'}]}],missingFacts:[],limitations:[]},{...sources,uncertain:false,questions:sources.questions.filter(q=>!q.uncertain)});
  // API fixtures isolate keyboard behavior; D1/R2 and the real provider have separate integration coverage.
  const responses:Record<string,unknown>={coaching:{state:'ready',jobs:[{id:'coach',threadId:groups[0].id,state:'ready',result:advice,error:null}]},media:{upload:{id:'u',state:'admitted',name:'test.wav',parts:[]},admitted:1,reserved:0,allowance:3},processing:{state:'ready',result:{durationMs:9000}},transcript:{id:'t',state:'ready',transcript},speakers:{id:'s',transcriptId:'t',speakers:['B'],state:'confirmed'},threads:{state:'partial',total:2,completed:1,errors:[{section:2,error:'Section unavailable.'}],groups}};
  for(const [endpoint,data] of Object.entries(responses))await page.route(`**/api/reviews/${review.id}/${endpoint}`,route=>route.fulfill({json:data}));
  await page.goto(`/reviews/${review.id}`);
  const root=page.locator('summary').filter({hasText:'What did you build?'});await root.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Original answer',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Proposed future answer'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Supporting evidence'})).toBeVisible();
  const follow=page.locator('summary').filter({hasText:'What would you change?'});await follow.focus();await page.keyboard.press('Enter');
  await expect(page.getByText('No supported answer was linked to this question.')).toBeVisible();
  await expect(page.getByText('This association is uncertain. Compare it with the transcript and audio.')).toBeVisible();
  const play=page.getByRole('button',{name:'Play passage at 0:04',exact:true});await play.focus();await page.keyboard.press('Enter');
  await expect(page.getByText(/Some sections could not be grouped/)).toBeVisible();
  await page.getByRole('button',{name:'Edit future answer',exact:true}).click();await page.getByRole('textbox',{name:'Your future answer',exact:true}).fill('My draft stays with the original coaching result.');
  await page.route(`**/api/reviews/${review.id}/coaching`,route=>route.fulfill({json:{state:'outdated',jobs:[{id:'coach',threadId:groups[0].id,state:'outdated',result:advice,error:null}]}}));
  const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('textbox',{name:'Your future answer',exact:true})).toHaveValue('My draft stays with the original coaching result.');await other.close();
  await expect(page.getByText(/Earlier advice: its source evidence changed/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Proposed future answer'})).toBeVisible();
  let queuedPolls=0;await page.route(`**/api/reviews/${review.id}/coaching`,route=>{queuedPolls++;return route.fulfill({json:queuedPolls<3?{state:'queued',jobs:[]}:responses.coaching});});
  await page.reload();await root.focus();await page.keyboard.press('Enter');
  await expect(page.getByText(/Coaching is waiting for its processing slot/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Proposed future answer'})).toBeVisible({timeout:15000});
  await context.request.delete(`/api/reviews/${review.id}`,{headers:{origin},data:{}});
});
