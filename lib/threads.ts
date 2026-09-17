import { z } from 'zod';
import type { Transcript } from './transcript';
const quoteSchema = z.object({utteranceId:z.string().min(1).max(160),quote:z.string().min(1).max(50000)}).strict();
export const groupingSchema = z.object({groups:z.array(z.object({
  question:z.array(quoteSchema).min(1).max(16), answers:z.array(quoteSchema).max(64),
  parent:quoteSchema.nullable(), uncertain:z.boolean(),
}).strict()).max(64)}).strict();
export const groupingJsonSchema = z.toJSONSchema(groupingSchema);
export type Evidence = {transcriptId:string;utteranceId:string;quote:string;start:number;end:number;startMs:number;endMs:number;position:number;uncertain:boolean};
export type QuestionGroup = {id:string;question:Evidence[];answers:Evidence[];parentId:string|null;uncertain:boolean};
const anchorId = (anchor:Evidence) => JSON.stringify([anchor.transcriptId,anchor.utteranceId,anchor.start,anchor.end]);
const compare = (a:Evidence,b:Evidence) => a.position-b.position || a.start-b.start;
export function resolveGroups(input:unknown, transcript:Transcript, transcriptId:string, candidateSpeakers:string[]):QuestionGroup[] {
  const sources = new Map(transcript.utterances.map((u,position)=>[u.id,{...u,position}]));
  function resolve(ref:z.infer<typeof quoteSchema>, role:'question'|'answer'):Evidence {
    const source=sources.get(ref.utteranceId); if(!source) throw new Error('Unknown transcript source.');
    const start=source.text.indexOf(ref.quote);
    if(start<0 || source.text.indexOf(ref.quote,start+1)>=0) throw new Error('Quote must match exactly once.');
    if(source.speaker && candidateSpeakers.includes(source.speaker)!==(role==='answer')) throw new Error('Evidence has the wrong confirmed speaker role.');
    return {transcriptId,utteranceId:source.id,quote:ref.quote,start,end:start+ref.quote.length,startMs:source.startMs,endMs:source.endMs,position:source.position,uncertain:!source.speaker||source.overlap};
  }
  return groupingSchema.parse(input).groups.map(group=>{
    const question=group.question.map(q=>resolve(q,'question')).sort(compare), answers=group.answers.map(a=>resolve(a,'answer')).sort(compare);
    const parent=group.parent?resolve(group.parent,'question'):null;
    // Strictly earlier parent anchors make cycles impossible, including across windows.
    if(parent && compare(parent,question[0])>=0) throw new Error('Follow-up parent must precede its question.');
    return {id:anchorId(question[0]),question,answers,parentId:parent?anchorId(parent):null,uncertain:group.uncertain||[...question,...answers].some(a=>a.uncertain)||answers.some(a=>compare(a,question[0])<0)};
  });
}
export function mergeGroups(groups:QuestionGroup[]):QuestionGroup[] {
  const merged=new Map<string,QuestionGroup>();
  const union=(a:Evidence[],b:Evidence[])=>[...new Map([...a,...b].map(e=>[anchorId(e),e])).values()].sort(compare);
  for(const group of groups) {
    const prior=merged.get(group.id);
    merged.set(group.id,prior?{...prior,question:union(prior.question,group.question),answers:union(prior.answers,group.answers),uncertain:prior.uncertain||group.uncertain||prior.parentId!==group.parentId}:structuredClone(group));
  }
  // A missing parent is visible as an uncertain standalone question, never dropped.
  return [...merged.values()].map(group=>group.parentId&&!merged.has(group.parentId)?{...group,uncertain:true,parentId:null}:group).sort((a,b)=>compare(a.question[0],b.question[0]));
}
export function groupingWindows(transcript:Transcript) {
  const windows:Transcript['utterances'][]=[];
  const bytes=(items:Transcript['utterances'])=>new TextEncoder().encode(JSON.stringify(items)).length;
  for(let start=0;start<transcript.utterances.length;) {
    let from=Math.max(0,start-8), end=start+1;
    while(from<start && bytes(transcript.utterances.slice(from,end))>210000) from++;
    while(end<Math.min(transcript.utterances.length,start+24) && bytes(transcript.utterances.slice(from,end+1))<=210000) end++;
    windows.push(transcript.utterances.slice(from,end));start=end;
  }
  return windows;
}
