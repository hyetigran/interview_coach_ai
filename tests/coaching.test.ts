import { expect,test } from 'vitest';
import { resolveCoaching, coachingGenerationSchema, coachingSources, COACHING_VERSIONS } from '../lib/coaching';
import { resolveGroups } from '../lib/threads';
import type { Transcript } from '../lib/transcript';
const transcript:Transcript={version:1,model:'gpt-4o-transcribe-diarize',audioSha256:'hash',durationMs:5000,utterances:[
{id:'q',speaker:'A',text:'Tell me about a project you led.',startMs:0,endMs:2000,overlap:false},
{id:'a',speaker:'B',text:'I led a migration with two engineers.',startMs:2000,endMs:5000,overlap:false}]};
const groups=resolveGroups({groups:[{question:[{utteranceId:'q',quote:transcript.utterances[0].text}],answers:[{utteranceId:'a',quote:transcript.utterances[1].text}],parent:null,uncertain:false}]},transcript,'v1',['B']);
const sources=coachingSources(groups[0],groups);
const quote={sourceId:sources.answers[0].sourceId,quote:'I led a migration with two engineers.'};
const proposal={outcome:'improve',questionType:'past_project',rationale:'Start with your contribution, then explain the decision.',dimensions:['ownership','organization'],segments:[{kind:'assertion',text:'I led a migration with two engineers.',citations:[quote]}],missingFacts:['What decision did you make, and why?'],limitations:[]};
test('resolves supported proposed assertions to exact immutable evidence and saves generation versions',()=>{
 const result=resolveCoaching(proposal,sources);expect(result.segments[0].citations[0]).toMatchObject({transcriptId:'v1',start:0,end:37,startMs:2000,endMs:5000});expect(result.versions).toEqual(COACHING_VERSIONS);
});
test('rejects unsupported, question-only, stale-version and ambiguous personal citations',()=>{
 for(const citations of [[],[{sourceId:'old-source',quote:quote.quote}],[{sourceId:sources.questions[0].sourceId,quote:transcript.utterances[0].text}]])expect(()=>resolveCoaching({...proposal,segments:[{...proposal.segments[0],citations}]},sources)).toThrow();
});
test('uncertain essential questions withhold confident advice and preserve a focused clarification',()=>{
 const uncertain={...sources,questions:sources.questions.map(q=>({...q,uncertain:true}))};expect(()=>resolveCoaching(proposal,uncertain)).toThrow();
 const result=resolveCoaching({...proposal,outcome:'missing_facts',rationale:'Confirm the question wording before assessing coverage.',dimensions:[],segments:[],missingFacts:['What was the interviewer asking?']},uncertain);expect(result.outcome).toBe('missing_facts');
});
test('new background assertions carry distinct provenance; job descriptions cannot prove achievement',()=>{
 const background={sourceId:'ctx:2:resume',contextId:'ctx:2',kind:'background' as const,label:'Selected resume',quote:'I built a service.',start:0,end:18};
 const selected={...sources,context:[background,{...background,sourceId:'ctx:2:job',kind:'job' as const}]};
 const alternative={...proposal,rationale:'This supplied service story addresses the project leadership question.',segments:[{kind:'alternative',text:'I built a service.',citations:[{sourceId:background.sourceId,quote:background.quote}]}]};
 expect(resolveCoaching(alternative,selected).segments[0].citations[0]).toMatchObject({origin:'background',contextId:'ctx:2'});
 expect(()=>resolveCoaching({...alternative,segments:[{...alternative.segments[0],citations:[{sourceId:'ctx:2:job',quote:background.quote}]}]},selected)).toThrow();
 expect(()=>resolveCoaching(alternative,sources)).toThrow();
 expect(()=>resolveCoaching({...alternative,segments:[{...alternative.segments[0],citations:[quote]}]},selected)).toThrow();
});

test('the provider schema restricts personal citations to supplied answer IDs',()=>{
 const schema=coachingGenerationSchema(sources);expect(()=>schema.parse({...proposal,segments:[{...proposal.segments[0],citations:[{sourceId:'v1',quote:quote.quote}]}]})).toThrow();expect(schema.parse(proposal).segments).toHaveLength(1);
});
