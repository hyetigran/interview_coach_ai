import { z } from 'zod';
export const utteranceSchema = z.object({ id: z.string(), speaker: z.string().nullable(), text: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), overlap: z.boolean() });
export const transcriptSchema = z.object({ version: z.literal(1), model: z.literal('gpt-4o-transcribe-diarize'), audioSha256: z.string(), durationMs: z.number(), utterances: z.array(utteranceSchema).max(20000) });
export type Transcript = z.infer<typeof transcriptSchema>;
const providerSchema = z.object({ duration: z.number().positive().max(3602), segments: z.array(z.object({ text: z.string().max(50000), speaker: z.string().max(100).nullish(), start: z.number().nonnegative(), end: z.number().positive() })).max(20000), usage: z.object({ type: z.literal('tokens'), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional() });
export function parseTranscript(input: unknown, id: string, audioSha256: string, durationMs: number) {
  const data = providerSchema.parse(input);
  if (Math.abs(data.duration * 1000 - durationMs) > 2000) throw new Error('Transcript duration does not match the recording.');
  let previousEnd = 0;
  const utterances = data.segments.map((segment, index) => {
    if (segment.end <= segment.start || segment.end * 1000 > durationMs + 1000 || (index && segment.start < data.segments[index - 1].start)) throw new Error('Transcript timestamps are invalid.');
    const startMs = Math.round(segment.start * 1000), endMs = Math.min(durationMs, Math.round(segment.end * 1000));
    if (startMs < 0 || startMs >= endMs || endMs > durationMs) throw new Error('Normalized transcript timestamps are invalid.');
    const overlap = previousEnd > segment.start || Boolean(data.segments[index + 1] && data.segments[index + 1].start < segment.end); previousEnd = Math.max(previousEnd, segment.end);
    return { id: `${id}:${index}`, text: segment.text, speaker: segment.speaker ?? null, startMs, endMs, overlap };
  });
  return { transcript: transcriptSchema.parse({ version: 1, model: 'gpt-4o-transcribe-diarize', audioSha256, durationMs, utterances }), usage: data.usage };
}
