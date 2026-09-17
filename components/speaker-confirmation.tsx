'use client';
import {speakerName} from './attribution-correction';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Transcript } from '@/lib/transcript';
import { Button } from './ui/button';
type Confirmation = { id: string; transcriptId: string; speakers: string[]; state: string } | null;
export function SpeakerConfirmation({ reviewId, transcriptId, transcript }: { reviewId: string; transcriptId: string; transcript: Transcript }) {
  const client = useQueryClient(); const key = ['speakers',reviewId,transcriptId]; const path = `/api/reviews/${reviewId}/speakers`;
  const query = useQuery({ queryKey: key, queryFn: () => api<Confirmation>(path), refetchInterval: query => ['queued','running'].includes(query.state.data?.state ?? '') ? 1500 : false });
  const [selected, setSelected] = useState<string[]>([]); const player = useRef<HTMLAudioElement>(null); const stopAt = useRef(0);
  const labels = [...new Set(transcript.utterances.map(u => u.speaker).filter((speaker): speaker is string => speaker !== null))];
  const mutation = useMutation({ mutationFn: () => api(path, { method: 'POST', body: JSON.stringify({ actionId: crypto.randomUUID(), transcriptId, speakers: selected }) }), onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  if (query.error) return <p role="alert">Unable to load your speaker selection. Reload to retry.</p>;
  const saved = query.data;
  return <section className="rounded-lg border p-4 space-y-3" aria-labelledby="voice-heading">
    <h4 id="voice-heading" className="font-medium">Which voice is yours?</h4>
    <p className="text-sm text-muted-foreground">Listen to the samples, then select every label that is your voice. One person may have several labels. You do not need to approve each passage.</p>
    <audio ref={player} preload="metadata" controls aria-label="Speaker sample playback" src={`/api/reviews/${reviewId}/audio`} onTimeUpdate={() => { if (player.current && stopAt.current && player.current.currentTime >= stopAt.current) { player.current.pause(); stopAt.current = 0; } }} />
    <fieldset disabled={query.isPending || mutation.isPending || Boolean(saved)} className="space-y-2"><legend className="sr-only">Select your speaker labels</legend>
      {labels.map(label => { const sample = transcript.utterances.find(u => u.speaker === label && !u.overlap) ?? transcript.utterances.find(u => u.speaker === label)!; return <div key={label} className="flex items-center gap-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={(saved?.speakers ?? selected).includes(label)} onChange={event => setSelected(values => event.target.checked ? [...values,label] : values.filter(value => value !== label))} />{speakerName(label)}</label>
        <Button type="button" variant="outline" onClick={() => { if (player.current) { player.current.currentTime = sample.startMs / 1000; stopAt.current = Math.min(sample.endMs / 1000, sample.startMs / 1000 + 10); void player.current.play().catch(() => {}); } }}>Listen to {speakerName(label)}</Button>
      </div>; })}
    </fieldset>
    {!labels.length && <p>No identifiable speaker labels were returned. Coaching needs a confirmed candidate voice.</p>}
    {saved ? <p role="status">{saved.state === 'confirmed' ? 'Your voice is confirmed.' : ['queued','running'].includes(saved.state) ? 'Your selection is saved. Waiting to continue…' : 'Your selection is saved, but processing could not continue.'}</p> : <Button disabled={!selected.length || mutation.isPending || query.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Saving…' : 'Confirm my voice'}</Button>}
    {mutation.error && <p role="alert">{mutation.error.message}</p>}
  </section>;
}
