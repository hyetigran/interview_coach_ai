import { z } from 'zod';
import type { Evidence,QuestionGroup } from './threads';
export const COACHING_VERSIONS={model:'gpt-4.1-mini-2025-04-14',prompt:'content-coach-v1',rubric:'question-content-v1',schema:'coaching-v1',verification:'assertion-support-v1'} as const;
const citation=z.object({sourceId:z.string().min(1).max(500),quote:z.string().min(1).max(10000)}).strict();
export const coachingSchema=z.object({
  outcome:z.enum(['improve','preserve','missing_facts']),questionType:z.enum(['behavioral','past_project','unsupported']),
  rationale:z.string().min(1).max(1000),dimensions:z.array(z.enum(['coverage','specificity','ownership','organization','reasoning'])).max(5),
  segments:z.array(z.object({kind:z.literal('assertion'),text:z.string().min(1).max(2000),citations:z.array(citation).min(1).max(8)}).strict()).max(12),
  missingFacts:z.array(z.string().min(1).max(500)).max(5),limitations:z.array(z.string().min(1).max(500)).max(8),
}).strict();
export type CoachingSources={questions:(Evidence&{sourceId:string})[];answers:(Evidence&{sourceId:string})[];uncertain:boolean};
export function coachingSources(root:QuestionGroup,groups:QuestionGroup[]):CoachingSources {
  const included=new Set([root.id]);let changed=true;
  while(changed){changed=false;for(const group of groups)if(group.parentId&&included.has(group.parentId)&&!included.has(group.id)){included.add(group.id);changed=true;}}
  const thread=groups.filter(g=>included.has(g.id));
  const unique=(evidence:Evidence[])=>[...new Map(evidence.map(e=>{const sourceId=JSON.stringify([e.transcriptId,e.utteranceId,e.start,e.end]);return [sourceId,{...e,sourceId}];})).values()];
  return {questions:unique(thread.flatMap(g=>g.question)),answers:unique(thread.flatMap(g=>g.answers)),uncertain:thread.some(g=>g.uncertain)};
}
export function unclearEvidence(evidence:Evidence) {return evidence.uncertain||/\[(?:inaudible|unintelligible|unclear)\]/i.test(evidence.quote);}
export function resolveCoaching(input:unknown,sources:CoachingSources) {
  const data=coachingSchema.parse(input);
  if((sources.uncertain||sources.questions.some(unclearEvidence)||data.questionType==='unsupported')&&(data.outcome!=='missing_facts'||data.segments.length||data.dimensions.length))throw new Error('Unclear or unsupported questions cannot receive confident advice.');
  if(data.outcome==='missing_facts'&&(!data.missingFacts.length||data.segments.length))throw new Error('Missing facts require a focused question and no unsupported proposal.');
  if(data.outcome!=='missing_facts'&&!data.segments.length)throw new Error('An improvement or preservation needs a supported proposed answer.');
  const segments=data.segments.map(segment=>({...segment,citations:segment.citations.map(ref=>{
    const source=sources.answers.find(s=>s.sourceId===ref.sourceId);
    if(!source||unclearEvidence(source))throw new Error('A personal assertion requires clear candidate answer evidence.');
    const start=source.quote.indexOf(ref.quote);
    if(start<0||source.quote.indexOf(ref.quote,start+1)>=0)throw new Error('Citation must match exactly once.');
    return {...source,quote:ref.quote,start:source.start+start,end:source.start+start+ref.quote.length};
  })}));
  return {...data,segments,versions:COACHING_VERSIONS};
}
export type CoachingResult=ReturnType<typeof resolveCoaching>;
export function withheldCoaching(sources:CoachingSources):CoachingResult {
  return resolveCoaching({outcome:'missing_facts',questionType:'unsupported',rationale:'The question or speaker attribution needs confirmation before this answer can be assessed.',dimensions:[],segments:[],missingFacts:['After listening to the linked passages, what was the exact question and which passages were your answer?'],limitations:['Advice depending on unclear speech or attribution is withheld.'],},sources);
}
