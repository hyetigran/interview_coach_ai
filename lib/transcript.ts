import { z } from 'zod';
export const utteranceSchema = z.object({ id: z.string(), speaker: z.string().nullable(), text: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), overlap: z.boolean(), timingUncertain:z.boolean().optional(), boundaryUncertain:z.boolean().optional(), corrected: z.boolean().optional(), attributionCorrected:z.boolean().optional() });
export const transcriptSchema = z.object({ version: z.literal(1), model: z.literal('gpt-4o-transcribe-diarize'), audioSha256: z.string(), durationMs: z.number(), utterances: z.array(utteranceSchema).max(20000) });
export type Transcript = z.infer<typeof transcriptSchema>;
const providerSchema = z.object({ duration: z.number().positive().max(3602), segments: z.array(z.object({ text: z.string().max(50000), speaker: z.string().max(100).nullish(), start: z.number().nonnegative(), end: z.number().positive() })).max(20000), usage: z.object({ type: z.literal('tokens'), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional() });
export function parseTranscript(input: unknown, id: string, audioSha256: string, durationMs: number) {
  const data = providerSchema.parse(input);
  if (Math.abs(data.duration * 1000 - durationMs) > 2000) throw new Error('Transcript duration does not match the recording.');
  const utterances:Transcript['utterances'] = data.segments.map((segment, index) => {
    if (segment.end <= segment.start || segment.end * 1000 > durationMs + 1000 || (index && segment.start < data.segments[index - 1].start)) throw new Error('Transcript timestamps are invalid.');
    const startMs = Math.round(segment.start * 1000), endMs = Math.min(durationMs, Math.round(segment.end * 1000));
    if (startMs < 0 || startMs >= endMs || endMs > durationMs) throw new Error('Normalized transcript timestamps are invalid.');
    return { id: `${id}:${index}`, text: segment.text, speaker: segment.speaker ?? null, startMs, endMs, overlap:false };
  });
  markOverlaps(utterances,false);
  markOverlaps(utterances,true);
  return { transcript: transcriptSchema.parse({ version: 1, model: 'gpt-4o-transcribe-diarize', audioSha256, durationMs, utterances }), usage: data.usage };
}

// Keep the two strongest bounds from distinct speaker labels. Each passage can
// then find an overlapping different/unknown voice without a quadratic scan.
function markOverlaps(utterances:Transcript['utterances'],reverse:boolean){
 const bounds:{speaker:string|null;value:number}[]=[],sameSpeaker=new Map<string,number>();
 const compare=(a:number,b:number)=>reverse?a-b:b-a;
 for(const utterance of reverse?[...utterances].reverse():utterances){
  const speaker=utterance.speaker?.trim()?utterance.speaker:null;
  const edge=reverse?utterance.endMs:utterance.startMs;
  const overlaps=(value:number)=>reverse?value<edge:value>edge;
  const other=bounds.find(bound=>speaker===null||bound.speaker===null||bound.speaker!==speaker);
  if(other&&overlaps(other.value))utterance.overlap=true;
  const same=speaker===null?undefined:sameSpeaker.get(speaker);
  if(same!==undefined&&overlaps(same))utterance.timingUncertain=true;
  const value=reverse?utterance.startMs:utterance.endMs;
  if(speaker!==null)sameSpeaker.set(speaker,same===undefined||compare(value,same)<0?value:same);
  const existing=bounds.find(bound=>bound.speaker===speaker);
  if(existing){if(compare(value,existing.value)<0)existing.value=value;}
  else bounds.push({speaker,value});
  bounds.sort((a,b)=>compare(a.value,b.value));bounds.splice(2);
 }
}
