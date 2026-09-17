import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {CoachingResult} from '../lib/coaching';
import {registerInvited} from './register-invited';
import {testOrigin as origin, invitationFlags} from './test-target';

for(const kind of ['AUDIO','VIDEO'] as const){
  test(`60-minute ${kind.toLowerCase()} reaches saved preparation with real providers`,async({page,context})=>{
    const source=process.env[`E2E_HOUR_${kind}`];
    test.skip(!source,'Explicit paid integration test requires a permissioned or synthetic 60-minute fixture.');
    test.setTimeout(35*60000);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',source!],{encoding:'utf8',timeout:30000}));
    expect(Number(probe.format.duration)).toBe(3600);
    expect(probe.streams.some((stream:{codec_type:string})=>stream.codec_type==='audio')).toBe(true);
    expect(probe.streams.some((stream:{codec_type:string})=>stream.codec_type==='video')).toBe(kind==='VIDEO');
    const email=`hour-${randomUUID()}@example.com`;
    const invitation=execFileSync('node',['scripts/invite.mjs',email,...invitationFlags],{encoding:'utf8'}).trim().split('\n').at(-1)!;
    const signup=await registerInvited(context.request,{headers:{origin,'x-invitation-token':invitation},data:{name:'Boundary Pipeline Test',email,password:randomUUID()+randomUUID()}});
    expect(signup.ok()).toBeTruthy();
    const created=await context.request.post('/api/reviews',{headers:{origin},data:{title:'60-minute processing acceptance',role:'Software engineer',origin:'mock'}});
    expect(created.ok()).toBeTruthy();const review=await created.json(),endpoint='/api/reviews/'+review.id;
    try {
      await page.goto('/reviews/'+review.id);
      await page.getByLabel('Interview recording file',{exact:true}).setInputFiles(source!);
      await page.getByRole('button',{name:'Upload recording',exact:true}).click();
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/processing')).json())?.state,{timeout:15*60000,intervals:[3000,10000]}).toBe('ready');
      const prepared=await(await context.request.get(endpoint+'/processing')).json();
      expect(prepared.result.durationMs).toBe(3600000);
      if(kind==='VIDEO')expect(prepared.result.audioKey).not.toBe(prepared.result.sourceKey);
      await page.goto('/reviews');await page.goto('/reviews/'+review.id);
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/transcript')).json())?.state,{timeout:16*60000,intervals:[5000,10000]}).toBe('ready');
      const transcript=await(await context.request.get(endpoint+'/transcript')).json();
      expect(transcript.transcript.durationMs).toBe(3600000);
      expect(transcript.transcript.utterances.length).toBeGreaterThan(0);
      // A source with speech near the end is required; an excerpt-only result fails.
      expect(Math.max(...transcript.transcript.utterances.map((u:{endMs:number})=>u.endMs))).toBeGreaterThan(3500000);
      await page.reload();
      const label=transcript.transcript.utterances.find((u:{speaker:string|null;text:string})=>u.speaker&&/event.driven/i.test(u.text))?.speaker;
      expect(label,'Fixture must contain the candidate’s event-driven-service answer').toBeTruthy();
      const candidate=page.getByRole('checkbox',{name:'Speaker '+label,exact:true});
      await candidate.focus();await candidate.press('Space');
      await page.getByRole('button',{name:'Confirm my voice',exact:true}).click();
      await expect(page.getByText('Your voice is confirmed.',{exact:true})).toBeVisible();
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/threads')).json())?.state,{timeout:180000,intervals:[3000,10000]}).toBe('ready');
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/coaching')).json())?.state,{timeout:300000,intervals:[3000,10000]}).toMatch(/^(ready|partial)$/);
      const coaching=await(await context.request.get(endpoint+'/coaching')).json();
      const job=coaching.jobs.find((item:{state:string;result:CoachingResult|null})=>item.state==='ready'&&item.result&&item.result.segments.length>0);
      expect(job,'At least one cited coaching result must be ready').toBeTruthy();
      for(const segment of job.result.segments){
        expect(segment.citations.length).toBeGreaterThan(0);
        for(const citation of segment.citations){expect(citation.origin).toBe('interview');expect(citation.utteranceId).toBeTruthy();expect(citation.quote.length).toBeGreaterThan(0);}
      }
      const answer='In my next interview I will distinguish my contribution, decision, and evidence.';
      const saved=await context.request.post(endpoint+'/preparation',{headers:{origin},data:{jobId:job.id,version:0,text:answer}});
      expect(saved.ok()).toBeTruthy();
      const priorities=['Explain my decision','State my contribution'];
      expect((await context.request.put(endpoint+'/preparation',{headers:{origin},data:{version:0,items:priorities}})).ok()).toBeTruthy();
      await page.reload();const panel=page.getByRole('region',{name:'Saved preparation'});
      await expect(panel.getByRole('textbox',{name:'Your future answer',exact:true}).first()).toHaveValue(answer);
      await expect(panel.getByRole('textbox',{name:'Priority 1',exact:true})).toHaveValue(priorities[0]);
      const persisted=await(await context.request.get(endpoint+'/preparation')).json();
      expect(persisted.answers.some((item:{text:string})=>item.text===answer)).toBe(true);
      expect(persisted.priorities.items).toEqual(priorities);
      expect([202,204]).toContain((await context.request.delete(endpoint,{headers:{origin},data:{}})).status());
      expect((await context.request.get(endpoint+'/audio')).status()).toBe(404);
      await expect.poll(async()=>(await(await context.request.get(endpoint+'/deletion')).json()).cleanupPending,{timeout:120000,intervals:[5000]}).toBe(false);
    } finally {await context.request.delete(endpoint,{headers:{origin},data:{},timeout:10000}).catch(()=>{});}
  });
}
