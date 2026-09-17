import { registerInvited } from './register-invited';
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('candidate saves preparation, recovers a conflict, returns in a new session and deletes it',async({page,context})=>{
 test.setTimeout(90000);
 const email=`preparation-${randomUUID()}@example.com`,password=randomUUID()+randomUUID(),origin='http://127.0.0.1:3000';
 const invitation=execFileSync('node',['scripts/invite.mjs',email],{encoding:'utf8'}).trim().split('\n').at(-1)!;
 const signup=await registerInvited(context.request,{headers:{origin,'x-invitation-token':invitation},data:{name:'Preparation Test',email,password}});expect(signup.ok()).toBeTruthy();const owner=(await signup.json()).user.id;
 const review=await (await context.request.post('/api/reviews',{headers:{origin},data:{title:'Saved preparation test',role:'Engineer',origin:'mock'}})).json();const endpoint=`/api/reviews/${review.id}/preparation`,job=randomUUID(),run=randomUUID();
 // Seed a completed synthetic coaching result; persistence, authentication and
 // annotations use real endpoints. Provider behavior is covered independently.
 const folder=mkdtempSync(join(tmpdir(),'preparation-fixture-'));
 try {
  const sources={questions:[{sourceId:'q',quote:'What did you build?'}],answers:[{sourceId:'a',quote:'I built a service.'}],uncertain:false,incomplete:false};
  const sql=`INSERT INTO coaching_runs(id,review_id,owner_id,revision,state,deadline,model,prompt_version,rubric_version,schema_version,verification_version) VALUES('${run}','${review.id}','${owner}',1,'ready',0,'fixture','fixture','fixture','fixture','fixture'); INSERT INTO coaching_jobs(id,run_id,thread_id,state,sources,result) VALUES('${job}','${run}','original-thread','ready','${JSON.stringify(sources)}','{}');`;
  const file=join(folder,'fixture.sql');writeFileSync(file,sql,{mode:0o600});execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--file',file],{stdio:'pipe'});
 } finally {rmSync(folder,{recursive:true,force:true});}
 expect((await context.request.post(endpoint,{headers:{origin},data:{jobId:job,version:0,text:'My first future answer.'}})).ok()).toBeTruthy();
 await page.goto(`/reviews/${review.id}`);const panel=page.getByRole('region',{name:'Saved preparation'});
 const answer=panel.getByRole('textbox',{name:'Your future answer',exact:true});await answer.fill('I built a service and would explain my decision.');await panel.getByRole('button',{name:'Save future answer',exact:true}).focus();await page.keyboard.press('Enter');await expect(panel.getByText('Future answer saved.',{exact:true})).toBeVisible();
 await panel.getByRole('textbox',{name:'Priority 1',exact:true}).fill('Explain my decision');await panel.getByRole('textbox',{name:'Priority 2',exact:true}).fill('State my contribution');await panel.getByRole('textbox',{name:'Priority 3',exact:true}).fill('Describe the outcome');await panel.getByRole('button',{name:'Save priorities',exact:true}).click();await expect(panel.getByText('Priorities saved.',{exact:true})).toBeVisible();
 expect((await context.request.put(endpoint,{headers:{origin},data:{version:1,items:['1','2','3','4']}})).status()).toBe(400);
 expect((await context.request.post(endpoint,{headers:{origin},data:{jobId:job,version:2,text:'Saved from another tab.'}})).ok()).toBeTruthy();
 // A failed background refresh must not let the explicit reload restore cached text.
 await page.route(`**${endpoint}`,route=>route.request().method()==='GET'?route.fulfill({status:503,json:{error:'Temporary outage'}}):route.continue());
 await answer.fill('My unsaved draft survives.');await panel.getByRole('button',{name:'Save future answer',exact:true}).click();await expect(panel.getByRole('alert').filter({hasText:'This saved answer changed'})).toBeVisible();await expect(answer).toHaveValue('My unsaved draft survives.');
 await panel.getByRole('button',{name:'Load latest saved answer'}).click();
 await expect(panel.getByText('Unable to load the latest answer. Your draft is preserved. Try again.')).toBeVisible();await expect(answer).toHaveValue('My unsaved draft survives.');
 await page.unroute(`**${endpoint}`);await panel.getByRole('button',{name:'Load latest saved answer'}).click();await expect(answer).toHaveValue('Saved from another tab.');
 expect((await context.request.put(endpoint,{headers:{origin},data:{version:1,items:['Latest priority']}})).ok()).toBeTruthy();
 await page.route(`**${endpoint}`,route=>route.request().method()==='GET'?route.fulfill({status:503,json:{error:'Temporary outage'}}):route.continue());
 await panel.getByRole('textbox',{name:'Priority 1',exact:true}).fill('Priority draft survives.');await panel.getByRole('button',{name:'Save priorities',exact:true}).click();
 await panel.getByRole('button',{name:'Load latest priorities'}).click();await expect(panel.getByText('Unable to load the latest priorities. Your draft is preserved. Try again.')).toBeVisible();await expect(panel.getByRole('textbox',{name:'Priority 1',exact:true})).toHaveValue('Priority draft survives.');
 await page.unroute(`**${endpoint}`);await panel.getByRole('button',{name:'Load latest priorities'}).click();await expect(panel.getByRole('textbox',{name:'Priority 1',exact:true})).toHaveValue('Latest priority');
 await panel.getByText('Evidence from this saved answer’s original snapshot',{exact:true}).click();await expect(panel.getByText('I built a service.',{exact:true})).toBeVisible();
 await answer.fill('Draft survives a failed refresh.');await panel.getByRole('textbox',{name:'Priority 1',exact:true}).fill('Unsaved priority');
 await page.route(`**${endpoint}`,route=>route.request().method()==='GET'?route.fulfill({status:503,json:{error:'Temporary outage'}}):route.continue());
 const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await expect(panel.getByText('Unable to refresh saved preparation. Your open drafts are preserved.')).toBeVisible({timeout:15000});await expect(answer).toHaveValue('Draft survives a failed refresh.');await expect(panel.getByRole('textbox',{name:'Priority 1',exact:true})).toHaveValue('Unsaved priority');await page.unroute(`**${endpoint}`);await other.close();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Your reviews'})).toBeVisible();await page.goto(`/reviews/${review.id}`);await expect(panel.getByRole('textbox',{name:'Priority 1',exact:true})).toHaveValue('Latest priority');await expect(answer).toHaveValue('Saved from another tab.');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete review',exact:true}).click();await expect(page.getByRole('heading',{name:'Your reviews'})).toBeVisible();expect((await context.request.get(endpoint)).status()).toBe(404);
});
