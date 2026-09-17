import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {coachingSources,COACHING_VERSIONS} from '../lib/coaching';
const sql=(value:string)=>"'"+value.replaceAll("'","''")+"'";
for(const stage of ['grouping','coaching'] as const)test(`candidate retries ${stage} and returns to the persisted result`,async({page,context})=>{
 test.setTimeout(150000);const origin='http://127.0.0.1:3000',email=`recovery-${randomUUID()}@example.com`;
 const invitation=execFileSync('node',['scripts/invite.mjs',email],{encoding:'utf8'}).trim().split('\n').at(-1)!;
 const signup=await context.request.post('/api/auth/sign-up/email',{headers:{origin,'x-invitation-token':invitation},data:{name:'Recovery Test',email,password:randomUUID()+randomUUID()}});expect(signup.ok()).toBeTruthy();const owner=(await signup.json()).user.id;
 const review=await (await context.request.post('/api/reviews',{headers:{origin},data:{title:`${stage} recovery`,role:'Engineer',origin:'mock'}})).json(),endpoint=`/api/reviews/${review.id}`;
 const transcriptId=randomUUID(),run=randomUUID(),job='coach-'+randomUUID(),key=`transcripts/${review.id}/${transcriptId}.json`;
 // Candidate-only grouping and incomplete coaching deterministically require no
 // provider request. Auth, retry admission, Workflow, D1 and R2 remain real.
 const transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'fixture',durationMs:2000,utterances:[{id:'q',speaker:stage==='grouping'?'B':'A',text:'What did you build?',startMs:0,endMs:1000,overlap:false},{id:'a',speaker:'B',text:'I built a service.',startMs:1000,endMs:2000,overlap:false}]};
 const evidence=(index:number)=>({transcriptId,utteranceId:transcript.utterances[index].id,quote:transcript.utterances[index].text,start:0,end:transcript.utterances[index].text.length,startMs:index*1000,endMs:(index+1)*1000,position:index,uncertain:false});
 const groups=[{id:'fixture-question',question:[evidence(0)],answers:[evidence(1)],parentId:null,uncertain:false}];
 const sources={...coachingSources(groups[0],groups),incomplete:true};
 const folder=mkdtempSync(join(tmpdir(),'analysis-recovery-'));
 try{
  const doc=join(folder,'transcript.json'),seed=join(folder,'seed.sql');writeFileSync(doc,JSON.stringify(transcript),{mode:0o600});execFileSync('pnpm',['exec','wrangler','r2','object','put',`interview-coach-local-media/${key}`,'--local','--file',doc],{stdio:'pipe'});
  const statements=[`INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key) VALUES(${sql(transcriptId)},${sql(review.id)},${sql(owner)},${sql(transcriptId)},1,'ready',${sql(key)});`,
   `INSERT INTO speaker_confirmations(id,review_id,owner_id,transcript_id,revision,speakers,state,confirmed_at) VALUES(${sql(run)},${sql(review.id)},${sql(owner)},${sql(transcriptId)},1,'["B"]','confirmed',0);`,
   `INSERT INTO grouping_runs(id,review_id,owner_id,transcript_id,revision,state,total,deadline) VALUES(${sql(run)},${sql(review.id)},${sql(owner)},${sql(transcriptId)},1,${sql(stage==='grouping'?'partial':'ready')},1,9999999999999);`,
   `INSERT INTO grouping_chunks(id,run_id,ordinal,state,result,error) VALUES(${sql('group-'+run+'-0')},${sql(run)},0,${sql(stage==='grouping'?'failed':'ready')},${stage==='grouping'?'NULL':sql(JSON.stringify(groups))},${stage==='grouping'?sql('Interrupted before submission'):'NULL'});`];
  if(stage==='coaching')statements.push(`INSERT INTO coaching_runs(id,review_id,owner_id,revision,context_revision,grouping_id,grouping_version,state,deadline,model,prompt_version,rubric_version,schema_version,verification_version) VALUES(${sql(run)},${sql(review.id)},${sql(owner)},1,1,${sql(run)},0,'partial',9999999999999,${[COACHING_VERSIONS.model,COACHING_VERSIONS.prompt,COACHING_VERSIONS.rubric,COACHING_VERSIONS.schema,COACHING_VERSIONS.verification].map(sql).join(',')});`,`INSERT INTO coaching_jobs(id,run_id,thread_id,state,sources,error) VALUES(${sql(job)},${sql(run)},'fixture-question','failed',${sql(JSON.stringify(sources))},'Interrupted before submission');`);
  writeFileSync(seed,statements.join('\n'),{mode:0o600});execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--file',seed],{stdio:'pipe'});
 }finally{rmSync(folder,{recursive:true,force:true});}
 await page.route(`**${endpoint}/media`,route=>route.fulfill({json:{upload:{id:'fixture',state:'admitted',name:'test.wav',parts:[]},admitted:1,reserved:0,allowance:3}}));await page.route(`**${endpoint}/processing`,route=>route.fulfill({json:{state:'ready',result:{durationMs:2000}}}));
 await page.goto(`/reviews/${review.id}`);if(stage==='coaching')await page.locator('summary').filter({hasText:/^What did you build\?$/}).click();
 const button=page.getByRole('button',{name:stage==='grouping'?'Retry question grouping':'Retry coaching',exact:true});await expect(button).toBeVisible({timeout:15000});await button.focus();
 const target=endpoint+(stage==='grouping'?'/threads':'/coaching'),method=stage==='grouping'?'POST':'PATCH';
 const accepted=page.waitForResponse(response=>response.url().endsWith(target)&&response.request().method()===method);await button.press('Enter');expect((await accepted).status()).toBe(202);
 await expect.poll(async()=>(await (await context.request.get(target)).json()).state,{timeout:100000}).toBe('ready');
 await page.reload();if(stage==='coaching'){await page.locator('summary').filter({hasText:/^What did you build\?$/}).click();await expect(page.getByRole('heading',{name:'Facts needed before a suggestion'})).toBeVisible();}else await expect(page.getByText('No supported interview questions were found in the completed sections.')).toBeVisible();
 await expect(page.getByRole('button',{name:stage==='grouping'?'Retry question grouping':'Retry coaching',exact:true})).toHaveCount(0);
 const ledger=JSON.parse(execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--json','--command',`SELECT state,settled_units FROM processing_budget WHERE id IN (${(stage==='grouping'?['group-'+run+'-0-attempt-1']:[job+'-attempt-1-draft',job+'-attempt-1-verify']).map(sql).join(',')})`],{encoding:'utf8'}));expect(ledger[0].results.length).toBeGreaterThan(0);for(const row of ledger[0].results)expect(row).toEqual({state:'settled',settled_units:0});
 await context.request.delete(endpoint,{headers:{origin},data:{}});
});
