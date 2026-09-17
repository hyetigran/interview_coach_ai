import {z} from 'zod';
import {attributionSchema,correctAttribution,manualGroupsSchema,resolveManualGroups} from '../lib/grouping-corrections';
import {candidateLabels,CorrectionError,createCorrectionModule} from './transcript-corrections';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'CONTINUATION'>;
export function createGroupingCorrectionModule(env:Environment) {
 const revisions=createCorrectionModule(env);
 async function status(owner:string,review:string) {
  const current=await env.DB.prepare("SELECT t.id,t.revision FROM transcriptions t JOIN reviews r ON r.id=t.review_id WHERE t.review_id=? AND t.owner_id=? AND r.owner_id=? AND r.lifecycle='active' AND t.state='ready' AND t.revision=r.input_revision").bind(review,owner,owner).first<{id:string;revision:number}>();
  if(!current)throw new CorrectionError(404,'Transcript unavailable.');
  return {transcriptId:current.id,revision:current.revision,candidateSpeakers:await candidateLabels(env.DB,review,current.id)??[]};
 }
 async function attribution(owner:string,review:string,input:unknown) {
  const value=attributionSchema.parse(input);
  return revisions.revise(owner,review,value.transcriptId,before=>correctAttribution(before,value,review));
 }
 async function grouping(owner:string,review:string,input:unknown) {
  const value=z.object({transcriptId:z.string().min(1).max(160),groupingId:z.string().min(1).max(160),version:z.number().int().nonnegative(),groups:manualGroupsSchema}).strict().parse(input);
  return revisions.revise(owner,review,value.transcriptId,async(before,id)=>{
   const run=await env.DB.prepare("SELECT output_version FROM grouping_runs WHERE id=? AND review_id=? AND owner_id=? AND transcript_id=? AND state IN ('running','ready','partial')").bind(value.groupingId,review,owner,value.transcriptId).first<{output_version:number}>();
   const manual=value.groupingId===value.transcriptId&&value.version===0?await env.DB.prepare("SELECT coverage FROM transcript_correction_intents WHERE id=? AND owner_id=? AND review_id=? AND state='published' AND manual_groups IS NOT NULL").bind(value.transcriptId,owner,review).first<{coverage:string}>():null;
   if(!manual&&(!run||run.output_version!==value.version))throw new CorrectionError(409,'Question grouping changed. Your draft is preserved; load the latest grouping before saving.');
   const speakers=await candidateLabels(env.DB,review,value.transcriptId);if(!speakers)throw new CorrectionError(409,'Confirm the candidate voice before correcting question groups.');
   const groups=resolveManualGroups(value.groups,before,id,speakers);
   if(new TextEncoder().encode(JSON.stringify(groups)).length>1000000)throw new CorrectionError(413,'Question grouping is too large for one correction.');
   const coverage=manual?JSON.parse(manual.coverage) as number[]:(await env.DB.prepare("SELECT ordinal FROM grouping_chunks WHERE run_id=? AND state='ready'").bind(value.groupingId).all<{ordinal:number}>()).results.map(r=>r.ordinal);
   return {transcript:before,candidateSpeakers:speakers,manualGroups:groups,coverage,groupingGuard:manual?undefined:{id:value.groupingId,version:value.version}};
  });
 }
 return {status,attribution,grouping};
}
