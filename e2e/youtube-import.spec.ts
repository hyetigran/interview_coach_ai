import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {registerInvited} from './register-invited';
import {testOrigin,invitationFlags} from './test-target';

test('paste a YouTube link, leave, return to prepared audio, and delete',async({page,context})=>{
 test.skip(process.env.E2E_YOUTUBE_IMPORT!=='1','Opt-in live YouTube retrieval; preview may incur normal pipeline costs.');
 test.setTimeout(240000);
 const email=`youtube-${randomUUID()}@example.com`;
 const invitation=execFileSync('node',['scripts/invite.mjs',email,...invitationFlags],{encoding:'utf8'}).trim().split('\n').at(-1)!;
 expect((await registerInvited(context.request,{headers:{origin:testOrigin,'x-invitation-token':invitation},data:{name:'YouTube import check',email,password:randomUUID()+randomUUID()}})).ok()).toBeTruthy();
 const created=await context.request.post('/api/reviews',{headers:{origin:testOrigin},data:{title:'YouTube interview import',role:'Staff ML engineer',origin:'mock'}});
 expect(created.ok()).toBeTruthy();const review=await created.json(),path=`/api/reviews/${review.id}`;
 try{
  await page.goto(`/reviews/${review.id}`);
  await page.getByLabel('YouTube video link',{exact:true}).fill('https://www.youtube.com/watch?v=sa41eWwM7iI');
  await page.getByLabel('Stop at (optional)',{exact:true}).fill('38:38');
  const accepted=page.waitForResponse(r=>new URL(r.url()).pathname===path+'/youtube'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Import from YouTube',exact:true}).click();expect((await accepted).status()).toBe(202);
  await page.goto('/');
  await expect.poll(async()=> (await(await context.request.get(path+'/processing')).json()).state,{timeout:150000,intervals:[1000,3000,5000]}).toBe('ready');
  await page.goto(`/reviews/${review.id}`);await expect(page.getByText('Recording prepared',{exact:true})).toBeVisible();
  const audio=page.getByLabel('Private interview recording');await expect(audio).toBeVisible();
  await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.duration)).toBe(2318);
  const media=await(await context.request.get(path+'/media')).json();expect(media.upload.state).toBe('admitted');expect(media.admitted).toBe(1);
  const replay=await context.request.post(path+'/youtube',{headers:{origin:testOrigin},data:{url:'https://youtu.be/sa41eWwM7iI',endSeconds:2318,actionId:randomUUID()}});expect(replay.status()).toBe(202);expect((await replay.json()).id).toBe(media.upload.id);
  await page.reload();await expect(page.getByText('Recording prepared',{exact:true})).toBeVisible();
  expect((await context.request.get(path+'/audio',{headers:{range:'bytes=0-43'}})).status()).toBe(206);
  expect([202,204]).toContain((await context.request.delete(path,{headers:{origin:testOrigin},data:{}})).status());
  expect((await context.request.get(path+'/audio')).status()).toBe(404);
 }finally{await context.request.delete(path,{headers:{origin:testOrigin},data:{}}).catch(()=>{});}
});
