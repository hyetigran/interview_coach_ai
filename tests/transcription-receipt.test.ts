import {test,expect} from 'vitest';
import {assembleTranscriptionParts} from '../lib/transcription-assembly';
import {transcriptionReceiptCharge,transcriptionReceiptTranscript} from '../server/transcription-receipt';
const response={duration:1200,segments:[{speaker:'A',text:'Why?',start:1199,end:1200}],usage:{type:'tokens',input_tokens:1,output_tokens:0}};
const transcript=assembleTranscriptionParts('t','hash',2400000,[0,1].map(index=>({index,offsetMs:index*1200000,durationMs:1200000,response})));
const receipt={kind:'transcription-parts-v1',callId:'t-attempt-1',chargeUnits:3,transcript};
test('aggregate receipt retains scoped speakers, boundary markers and explicit attempt-only charge',()=>{
 expect(transcriptionReceiptCharge(receipt,'t-attempt-1')).toBe(3);
 expect(transcriptionReceiptTranscript(receipt,'t-attempt-1','t','hash',2400000)).toEqual(transcript);
 expect(()=>transcriptionReceiptCharge(receipt,'t')).toThrow('another paid attempt');
 expect(()=>transcriptionReceiptTranscript(receipt,'t-attempt-1','t','other',2400000)).toThrow('source changed');
});
test('provider payload cannot claim the internal aggregate type or select its charge',()=>{
 const raw={response:JSON.stringify({...response,kind:'transcription-parts-v1',chargeUnits:0,transcript:{}})};
 expect(transcriptionReceiptCharge(raw,'t')).toBe(3);
 expect(transcriptionReceiptTranscript(raw,'t','t','hash',1200000).utterances[0].speaker).toBe('A');
 expect(transcriptionReceiptCharge({response:JSON.stringify({...response,usage:undefined})},'t')).toBeNull();
});
test('known billing remains readable when content is malformed; malformed accounting stays unresolved',()=>{
 expect(transcriptionReceiptCharge({...receipt,transcript:{}},'t-attempt-1')).toBe(3);
 expect(()=>transcriptionReceiptTranscript({...receipt,transcript:{}},'t-attempt-1','t','hash',2400000)).toThrow();
 for(const chargeUnits of [null,-1,1.5,6000001])expect(()=>transcriptionReceiptCharge({...receipt,chargeUnits},'t-attempt-1')).toThrow();
 expect(()=>transcriptionReceiptCharge({...receipt,kind:'unexpected'},'t-attempt-1')).toThrow();
});
test('saved aggregate rejects duplicate identities, unordered or out-of-range passages',()=>{
 const [a,b]=transcript.utterances;
 for(const utterances of [[a,a],[b,a],[{...a,endMs:2400001}],[{...a,id:'another:part-0:0'}]])
  expect(()=>transcriptionReceiptTranscript({...receipt,transcript:{...transcript,utterances}},'t-attempt-1','t','hash',2400000)).toThrow();
});
