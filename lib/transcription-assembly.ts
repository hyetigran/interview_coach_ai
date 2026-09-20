import {parseTranscript,transcriptSchema,type Transcript} from './transcript';
type PartResponse={index:number;offsetMs:number;durationMs:number;response:unknown};
/** Part-local speaker IDs have no identity relationship across provider requests. */
export function assembleTranscriptionParts(id:string,audioSha256:string,durationMs:number,parts:PartResponse[]):Transcript {
 if(!Number.isSafeInteger(durationMs)||durationMs<=0||durationMs>3600000||!parts.length||parts.length>3)throw new Error('Invalid transcription duration or part count.');
 let offset=0;
 const utterances=parts.flatMap((part,index)=>{
  if(part.index!==index||part.offsetMs!==offset||!Number.isSafeInteger(part.durationMs)||part.durationMs<=0||part.durationMs>1200000)throw new Error('Transcription parts do not form a continuous timeline.');
  offset+=part.durationMs;
  const {transcript}=parseTranscript(part.response,`${id}:part-${index}`,audioSha256,part.durationMs);
  return transcript.utterances.map(utterance=>({
   ...utterance,
   speaker:!utterance.speaker?.trim()?null:`Part ${index+1} / ${utterance.speaker}`,
   startMs:utterance.startMs+part.offsetMs,endMs:utterance.endMs+part.offsetMs,
   // The two-second boundary window reflects timestamp tolerance, not a
   // confidence estimate. Processing cuts must never imply overlapping speech.
   boundaryUncertain:(index>0&&utterance.startMs<=2000)||(index<parts.length-1&&utterance.endMs>=part.durationMs-2000),
  }));
 });
 if(offset!==durationMs)throw new Error('Transcription parts do not cover the recording.');
 return transcriptSchema.parse({version:1,model:'gpt-4o-transcribe-diarize',audioSha256,durationMs,utterances});
}
