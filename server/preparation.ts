import {z} from 'zod';
import {answerSaveSchema,prioritiesSchema,type Preparation,type SavedAnswer} from '../lib/preparation';
import type {CoachingSources} from '../lib/coaching';
export class PreparationError extends Error {constructor(public status:number,message:string){super(message);}}
export function createPreparationModule(db:D1Database) {
 async function owned(owner:string,review:string) {
  if(!await db.prepare("SELECT id FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review,owner).first())throw new PreparationError(404,'Review not found.');
 }
 async function get(owner:string,review:string):Promise<Preparation> {
  await owned(owner,review);
  const priorities=await db.prepare('SELECT version,body FROM review_priorities WHERE review_id=?').bind(review).first<{version:number;body:string}>();
  const rows=(await db.prepare('SELECT * FROM saved_answers a WHERE review_id=? AND version=(SELECT MAX(version) FROM saved_answers b WHERE b.review_id=a.review_id AND b.coaching_job_id=a.coaching_job_id) ORDER BY created_at DESC').bind(review).all<{id:string;coaching_job_id:string;thread_id:string;version:number;body:string;sources:string;created_at:number}>()).results;
  return {priorities:{version:priorities?.version??0,items:priorities?JSON.parse(priorities.body):[]},answers:rows.map(row=>({id:row.id,jobId:row.coaching_job_id,threadId:row.thread_id,version:row.version,text:row.body,question:(JSON.parse(row.sources) as CoachingSources).questions.map(q=>q.quote).join(' '),createdAt:row.created_at}))};
 }
 async function priorities(owner:string,review:string,input:unknown) {
  const value=z.object({version:z.number().int().nonnegative(),items:prioritiesSchema}).strict().parse(input);await owned(owner,review);
  const result=await db.prepare(`INSERT INTO review_priorities(review_id,version,body,updated_at) SELECT ?,1,?,? WHERE ?=0 AND EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active')
   ON CONFLICT(review_id) DO NOTHING`).bind(review,JSON.stringify(value.items),Date.now(),value.version,review,owner).run();
  // Existing rows with positive versions use a separate conditional update; the
  // initial insert path never overwrites a concurrent first save.
  const updated=value.version>0?await db.prepare("UPDATE review_priorities SET version=version+1,body=?,updated_at=? WHERE review_id=? AND version=? AND EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active')").bind(JSON.stringify(value.items),Date.now(),review,value.version,review,owner).run():result;
  if(!updated.meta.changes)throw new PreparationError(409,'Priorities changed in another tab. Your draft is preserved; load the latest saved version before trying again.');
  return {version:value.version+1,items:value.items};
 }
 async function save(owner:string,review:string,input:unknown):Promise<SavedAnswer> {
  const value=answerSaveSchema.parse(input);await owned(owner,review);
  const id=crypto.randomUUID(),createdAt=Date.now();
  const row=await db.prepare(`INSERT OR IGNORE INTO saved_answers(id,review_id,coaching_job_id,thread_id,version,body,sources,coaching_result,created_at)
   SELECT ?,review_id,coaching_job_id,thread_id,?,?,sources,coaching_result,? FROM (
    SELECT r.review_id,j.id AS coaching_job_id,j.thread_id,j.sources,j.result AS coaching_result FROM coaching_jobs j JOIN coaching_runs r ON r.id=j.run_id
     WHERE ?=0 AND j.id=? AND r.review_id=? AND j.state IN ('ready','outdated') AND j.sources IS NOT NULL AND j.result IS NOT NULL
    UNION ALL
    SELECT review_id,coaching_job_id,thread_id,sources,coaching_result FROM saved_answers WHERE ?>0 AND review_id=? AND coaching_job_id=? AND version=?
   ) source WHERE EXISTS(SELECT 1 FROM reviews WHERE id=source.review_id AND owner_id=? AND lifecycle='active')
   AND COALESCE((SELECT MAX(version) FROM saved_answers WHERE review_id=source.review_id AND coaching_job_id=source.coaching_job_id),0)=?
   RETURNING thread_id,sources`).bind(id,value.version+1,value.text,createdAt,value.version,value.jobId,review,value.version,review,value.jobId,value.version,owner,value.version).first<{thread_id:string;sources:string}>();
  if(!row)throw new PreparationError(409,'This saved answer changed or its source is unavailable. Your draft is preserved; load the latest saved version before trying again.');
  return {id,jobId:value.jobId,threadId:row.thread_id,version:value.version+1,text:value.text,question:(JSON.parse(row.sources) as CoachingSources).questions.map(q=>q.quote).join(' '),createdAt};
 }
 async function evidence(owner:string,review:string,id:string) {
  const row=await db.prepare("SELECT a.sources,a.coaching_result FROM saved_answers a JOIN reviews r ON r.id=a.review_id WHERE a.id=? AND a.review_id=? AND r.owner_id=? AND r.lifecycle='active'").bind(id,review,owner).first<{sources:string;coaching_result:string}>();
  if(!row)throw new PreparationError(404,'Saved answer not found.');
  return {sources:JSON.parse(row.sources) as CoachingSources,result:JSON.parse(row.coaching_result)};
 }
 return {get,priorities,save,evidence};
}
