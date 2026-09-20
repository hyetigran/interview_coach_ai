import {expect,test} from 'vitest';
import {parseTranscript} from '../lib/transcript';
import {resolveGroups} from '../lib/threads';
import {coachingSources} from '../lib/coaching';
const parse=(segments:{speaker:string|null;start:number;end:number;text:string}[])=>parseTranscript({duration:10,segments},'t','hash',10000).transcript;
test('same-speaker timestamp overlap stays visible without inventing simultaneous voices or withholding grounded coaching',()=>{
 const transcript=parse([{speaker:'A',start:0,end:1,text:'What did you do?'},{speaker:'B',start:2,end:4.196,text:'I wrote the retry handler.'},{speaker:'B',start:4,end:6,text:'I tested duplicate delivery.'}]);
 expect(transcript.utterances.map(u=>u.overlap)).toEqual([false,false,false]);
 expect(transcript.utterances.slice(1).map(u=>u.timingUncertain)).toEqual([true,true]);
 const groups=resolveGroups({groups:[{question:[{utteranceId:'t:0',quote:'What did you do?'}],answers:[{utteranceId:'t:1',quote:'I wrote the retry handler.'},{utteranceId:'t:2',quote:'I tested duplicate delivery.'}],parent:null,uncertain:false}]},transcript,'t',['B']);
 expect(coachingSources(groups[0],groups).uncertain).toBe(false);
});
test('nested different-speaker overlap marks every affected passage, including earlier containing speech',()=>{
 const transcript=parse([{speaker:'A',start:0,end:8,text:'Long passage.'},{speaker:'A',start:1,end:2,text:'Same voice.'},{speaker:'B',start:3,end:4,text:'Second voice.'},{speaker:'B',start:9,end:10,text:'Later.'}]);
 expect(transcript.utterances.map(u=>u.overlap)).toEqual([true,false,true,false]);
 expect(transcript.utterances.slice(0,2).map(u=>u.timingUncertain)).toEqual([true,true]);
});
test('unknown speaker overlap is not treated as one confirmed voice',()=>{
 const transcript=parse([{speaker:null,start:0,end:2,text:'Unidentified.'},{speaker:null,start:1,end:3,text:'Unidentified too.'},{speaker:'B',start:4,end:5,text:'Separated.'}]);
 expect(transcript.utterances.map(u=>u.overlap)).toEqual([true,true,false]);
});
