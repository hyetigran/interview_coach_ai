import {z} from 'zod';
import type {Transcript} from './transcript';
import {groupingWindows,type Evidence,type QuestionGroup} from './threads';
const span=z.object({utteranceId:z.string().min(1).max(160),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict();
export const manualGroupsSchema=z.array(z.object({key:z.string().min(1).max(600),question:z.array(span).min(1).max(16),answers:z.array(span).max(64),parent:z.string().min(1).max(600).nullable()}).strict()).max(1000);
export type ManualGroups=z.infer<typeof manualGroupsSchema>;
const boundary=(text:string,index:number)=>!(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));
export function resolveManualGroups(input:unknown,transcript:Transcript,transcriptId:string,candidateSpeakers:string[]):QuestionGroup[] {
 const groups=manualGroupsSchema.parse(input),sources=new Map(transcript.utterances.map((u,position)=>[u.id,{...u,position}]));
 const keys=new Set(groups.map(g=>g.key));if(keys.size!==groups.length)throw new Error('Each question must have a unique identity.');
 const evidence=(ref:z.infer<typeof span>,role:'question'|'answer'):Evidence=>{
  const source=sources.get(ref.utteranceId);if(!source||ref.start>=ref.end||ref.end>source.text.length||!boundary(source.text,ref.start)||!boundary(source.text,ref.end))throw new Error('Select a valid passage from this transcript.');
  if(source.speaker&&candidateSpeakers.includes(source.speaker)!==(role==='answer'))throw new Error('The selected passage has the wrong speaker role. Correct attribution first.');
  return {transcriptId,utteranceId:source.id,quote:source.text.slice(ref.start,ref.end),start:ref.start,end:ref.end,startMs:source.startMs,endMs:source.endMs,position:source.position,uncertain:!source.speaker||source.overlap||Boolean(source.boundaryUncertain)};
 };
 const compare=(a:Evidence,b:Evidence)=>a.position-b.position||a.start-b.start;
 const resolved=groups.map(group=>{const question=group.question.map(s=>evidence(s,'question')).sort(compare),answers=group.answers.map(s=>evidence(s,'answer')).sort(compare);if(answers.some(answer=>compare(answer,question[0])<0))throw new Error('An answer cannot precede its question.');return {key:group.key,id:JSON.stringify([transcriptId,question[0].utteranceId,question[0].start,question[0].end]),question,answers,parent:group.parent,uncertain:[...question,...answers].some(e=>e.uncertain)};});
 if(new Set(resolved.map(g=>g.id)).size!==resolved.length)throw new Error('The same question passage cannot have multiple parents or identities.');
 const byKey=new Map(resolved.map(g=>[g.key,g]));
 return resolved.map(group=>{const parent=group.parent?byKey.get(group.parent):null;if(group.parent&&!parent)throw new Error('Choose a parent question in this transcript.');if(parent&&compare(parent.question[0],group.question[0])>=0)throw new Error('A follow-up parent must be an earlier question; cycles are not allowed.');return {id:group.id,question:group.question,answers:group.answers,parentId:parent?.id??null,uncertain:group.uncertain};});
}
export const attributionSchema=z.object({transcriptId:z.string().min(1).max(160),candidateSpeakers:z.array(z.string().min(1).max(120)).max(100),passages:z.array(z.object({utteranceId:z.string().min(1).max(160),role:z.enum(['candidate','interviewer','unknown']),overlap:z.boolean()}).strict()).max(20000)}).strict();
export function correctAttribution(transcript:Transcript,input:z.infer<typeof attributionSchema>,identity:string) {
 const labels=new Set(transcript.utterances.map(u=>u.speaker).filter(Boolean));if(input.candidateSpeakers.some(label=>!labels.has(label)))throw new Error('Select labels present in this transcript.');
 const ids=new Set(transcript.utterances.map(u=>u.id));if(new Set(input.passages.map(p=>p.utteranceId)).size!==input.passages.length||input.passages.some(p=>!ids.has(p.utteranceId)))throw new Error('Each corrected passage must belong to this transcript and occur once.');
 const candidate=`candidate-${identity}`,interviewer=`interviewer-${identity}`,changes=new Map(input.passages.map(p=>[p.utteranceId,p]));
 const utterances=transcript.utterances.map(u=>{const change=changes.get(u.id);return change?{...u,speaker:change.role==='unknown'?null:change.role==='candidate'?candidate:interviewer,overlap:change.overlap,attributionCorrected:true}:u;});
 const present=new Set(utterances.map(u=>u.speaker));const candidateSpeakers=[...new Set([...input.candidateSpeakers,...(input.passages.some(p=>p.role==='candidate')?[candidate]:[])])].filter(s=>present.has(s)).sort();
 if(!candidateSpeakers.length)throw new Error('Identify at least one candidate speaker or passage before analysis.');
 return {transcript:{...transcript,utterances},candidateSpeakers};
}

// Keep explicit associations through child revisions only when every selected
// passage still has the same wording and audio bounds. Never search for a new
// occurrence of repeated text or infer a new speaker role.
export function inheritManualGroups(groups:QuestionGroup[],after:Transcript,transcriptId:string,speakers:string[],needsReview:boolean) {
 const sources=new Map(after.utterances.map(u=>[u.id,u]));
 const compatible=groups.every(g=>[...g.question,...g.answers].every(e=>{const u=sources.get(e.utteranceId);return u&&u.text.slice(e.start,e.end)===e.quote&&u.startMs===e.startMs&&u.endMs===e.endMs;}));
 if(!needsReview&&compatible) {
  try{return {groups:resolveManualGroups(groups.map(g=>({key:g.id,question:g.question.map(({utteranceId,start,end})=>({utteranceId,start,end})),answers:g.answers.map(({utteranceId,start,end})=>({utteranceId,start,end})),parent:g.parentId})),after,transcriptId,speakers),needsReview:false};}catch{/* Preserve the old graph for explicit reassociation. */}
 }
 return {groups,needsReview:true};
}

export function inheritGroupingCoverage(before:Transcript,after:Transcript,ordinals:number[]) {
 const windows=groupingWindows(before),covered=new Map(ordinals.flatMap(ordinal=>(windows[ordinal]??[]).map(u=>[u.id,JSON.stringify(u)] as const)));
 return groupingWindows(after).flatMap((window,ordinal)=>window.every(u=>covered.get(u.id)===JSON.stringify(u))?[ordinal]:[]);
}
