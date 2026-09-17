import {z} from 'zod';
import {groupingWindows} from './threads';
import {transcriptSchema,type Transcript} from './transcript';
export const correctionSchema=z.object({transcriptId:z.string().min(1).max(160),utteranceId:z.string().min(1).max(160),text:z.string().trim().min(1).max(50000),recordingOnly:z.literal(true)}).strict();
export function correctUtterance(transcript:Transcript,utteranceId:string,text:string):Transcript {
 const original=transcript.utterances.find(u=>u.id===utteranceId);if(!original)throw new Error('Passage not found.');
 // Correct wording in the whole identified utterance, never by searching for a
 // repeated quote. Audio bounds and attribution remain the original observations.
 const next=transcriptSchema.parse({...transcript,utterances:transcript.utterances.map(u=>u.id===utteranceId?{...u,text,corrected:true}:u)});
 if(new TextEncoder().encode(JSON.stringify(next)).length>8000000)throw new Error('Corrected transcript exceeds supported limits.');
 return next;
}
export function reusableGroupingPrefix(before:Transcript,after:Transcript) {
 const previous=groupingWindows(before),next=groupingWindows(after);
 let prefix=0;
 // Every window receives prior questions, so a change can affect every later
 // window. Compare all supplied text AND metadata, including uncited passages.
 while(prefix<previous.length&&prefix<next.length&&JSON.stringify(previous[prefix])===JSON.stringify(next[prefix]))prefix++;
 return {reusablePrefix:prefix,total:next.length};
}
export function rebaseUnchangedGroups(groups:import('./threads').QuestionGroup[],transcriptId:string) {
 const identity=(id:string)=>{const parts=JSON.parse(id) as unknown[];return JSON.stringify([transcriptId,...parts.slice(1)]);};
 return groups.map(group=>({...group,id:identity(group.id),parentId:group.parentId?identity(group.parentId):null,question:group.question.map(e=>({...e,transcriptId})),answers:group.answers.map(e=>({...e,transcriptId}))}));
}
export function coachingDependencyKey(sources:import('./coaching').CoachingSources) {
 const evidence=(items:import('./coaching').CoachingSources['answers'])=>items.map(({transcriptId:_version,sourceId:_identity,...supplied})=>supplied);
 // Opaque version identities may change when an unchanged passage is copied.
 // Every substantive source field, including uncited evidence and context, remains.
 return JSON.stringify({...sources,questions:evidence(sources.questions),answers:evidence(sources.answers)});
}
