import {z} from 'zod';
import {createRuntimeSpeakers} from './speakers';
import {createGroupingModule} from './grouping';
import {createCoachingModule} from './coaching';
import {correctionSchema,correctUtterance,reusableGroupingPrefix} from '../lib/transcript-corrections';
import {transcriptSchema} from '../lib/transcript';
type Environment=Pick<CloudflareEnv,'DB'|'MEDIA'|'CONTINUATION'>;
export class CorrectionError extends Error {constructor(public status:number,message:string){super(message);}}
export function createCorrectionModule(env:Environment) {
 const db=env.DB;
 async function save(owner:string,review:string,input:unknown) {
  const value=correctionSchema.parse(input);
  const original=await db.prepare("SELECT t.result_key,t.revision FROM transcriptions t JOIN reviews r ON r.id=t.review_id WHERE t.id=? AND t.review_id=? AND t.owner_id=? AND t.state='ready' AND r.lifecycle='active' AND r.input_revision=t.revision").bind(value.transcriptId,review,owner).first<{result_key:string;revision:number}>();
  if(!original)throw new CorrectionError(409,'The transcript changed or is unavailable. Your draft is preserved; load the latest version before saving.');
  const object=await env.MEDIA.get(original.result_key);if(!object)throw new CorrectionError(409,'Transcript unavailable.');
  const before=transcriptSchema.parse(await object.json());
  const utterance=before.utterances.find(u=>u.id===value.utteranceId);if(!utterance)throw new CorrectionError(400,'Passage not found.');
  if(utterance.text===value.text)return {id:value.transcriptId,revision:original.revision};
  const after=correctUtterance(before,value.utteranceId,value.text),id='correction-'+crypto.randomUUID(),key=`transcripts/${review}/${id}.json`,revision=original.revision+1;
  const grouping=await db.prepare("SELECT id,transcript_id FROM grouping_runs WHERE review_id=? AND revision<=? AND state IN ('ready','partial','running','outdated') ORDER BY revision DESC LIMIT 1").bind(review,original.revision).first<{id:string;transcript_id:string}>();
  const sourceRow=grouping?await db.prepare('SELECT result_key FROM transcriptions WHERE id=?').bind(grouping.transcript_id).first<{result_key:string}>():null;
  const sourceObject=sourceRow?await env.MEDIA.get(sourceRow.result_key):null;
  const reusable=sourceObject?reusableGroupingPrefix(transcriptSchema.parse(await sourceObject.json()),after).reusablePrefix:0;
  let prefix=0;
  if(grouping){const chunks=(await db.prepare('SELECT ordinal,state FROM grouping_chunks WHERE run_id=? ORDER BY ordinal').bind(grouping.id).all<{ordinal:number;state:string}>()).results;while(prefix<reusable&&chunks[prefix]?.ordinal===prefix&&chunks[prefix].state==='ready')prefix++;}
  const intent=await db.prepare("INSERT INTO transcript_correction_intents(id,review_id,owner_id,parent_id,revision,result_key,created_at,reuse_grouping_id,reuse_prefix) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active' AND input_revision=?)").bind(id,review,owner,value.transcriptId,revision,key,Date.now(),grouping?.id??null,prefix,review,owner,original.revision).run();
  if(!intent.meta.changes)throw new CorrectionError(409,'The transcript changed while saving. Your draft is preserved.');
  await env.MEDIA.put(key,JSON.stringify(after),{httpMetadata:{contentType:'application/json'}});
  // Persist the object intent first so interrupted writes remain discoverable for
  // cleanup. A zero-row conditional publication cannot publish dependent rows.
  const results=await db.batch([
   db.prepare("INSERT INTO transcriptions(id,review_id,owner_id,job_id,revision,state,result_key,parent_id,corrected_utterance_id,finished_at) SELECT ?,?,?,?,?, 'ready',?,?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active' AND input_revision=?) AND EXISTS(SELECT 1 FROM transcript_correction_intents WHERE id=? AND state='preparing')").bind(id,review,owner,id,revision,key,value.transcriptId,value.utteranceId,Date.now(),review,owner,original.revision,id),
   db.prepare("UPDATE reviews SET input_revision=?,updated_at=? WHERE id=? AND owner_id=? AND lifecycle='active' AND input_revision=? AND EXISTS(SELECT 1 FROM transcriptions WHERE id=? AND state='ready')").bind(revision,Date.now(),review,owner,original.revision,id),
   db.prepare("UPDATE transcript_correction_intents SET state='published' WHERE id=? AND EXISTS(SELECT 1 FROM transcriptions WHERE id=? AND state='ready')").bind(id,id),
  ]);
  if(!results[1].meta.changes){await db.prepare("UPDATE transcript_correction_intents SET state='discarded' WHERE id=? AND state='preparing'").bind(id).run();await env.MEDIA.delete(key);throw new CorrectionError(409,'The transcript changed while saving. Your draft is preserved.');}
  return {id,revision};
 }
 async function cleanup() {
  const rows=(await db.prepare("SELECT id,result_key FROM transcript_correction_intents i WHERE NOT EXISTS(SELECT 1 FROM reviews r WHERE r.id=i.review_id AND r.lifecycle='active') OR (state<>'published' AND (state='discarded' OR created_at<?))").bind(Date.now()-900000).all<{id:string;result_key:string}>()).results;
  for(const row of rows){const claimed=await db.prepare("UPDATE transcript_correction_intents SET state='discarded' WHERE id=? AND (NOT EXISTS(SELECT 1 FROM reviews WHERE reviews.id=transcript_correction_intents.review_id AND lifecycle='active') OR (state<>'published' AND (state='discarded' OR created_at<?))) RETURNING result_key").bind(row.id,Date.now()-900000).first<{result_key:string}>();if(claimed)await env.MEDIA.delete(claimed.result_key);}
 }
 async function refresh(owner:string,review:string,input:unknown) {
  const value=z.object({actionId:z.uuid(),transcriptId:z.string().min(1).max(160)}).strict().parse(input);
  const current=await db.prepare("SELECT t.id FROM transcriptions t JOIN reviews r ON r.id=t.review_id WHERE t.id=? AND t.review_id=? AND t.owner_id=? AND t.state='ready' AND t.parent_id IS NOT NULL AND r.lifecycle='active' AND r.input_revision=t.revision").bind(value.transcriptId,review,owner).first();
  if(!current)throw new CorrectionError(409,'Load the current corrected transcript before refreshing analysis.');
  const previous=await db.prepare(`WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM transcriptions WHERE id=? AND review_id=?
    UNION ALL SELECT t.id,t.parent_id FROM transcriptions t JOIN ancestors a ON t.id=a.parent_id WHERE t.review_id=?
   ) SELECT s.speakers FROM speaker_confirmations s JOIN ancestors a ON a.id=s.transcript_id WHERE s.review_id=? AND s.owner_id=? AND s.state IN ('confirmed','outdated','running','queued') ORDER BY s.revision DESC LIMIT 1`).bind(value.transcriptId,review,review,review,owner).first<{speakers:string}>();
  if(!previous)throw new CorrectionError(409,'Confirm your voice before refreshing analysis.');
  await createGroupingModule(env).cleanup();await createCoachingModule(env).cleanup();
  return createRuntimeSpeakers(env).confirm(owner,review,{...value,speakers:JSON.parse(previous.speakers)});
 }
 return {save,cleanup,refresh};
}
