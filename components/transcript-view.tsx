'use client';
import {TranscriptCorrection,RefreshCorrectedAnalysis} from './transcript-correction';
import { QuestionThreads } from './question-threads';
import { SpeakerConfirmation } from './speaker-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Transcript } from '@/lib/transcript';
import { Button } from './ui/button';
type State = { id: string; revision:number; parentId?:string|null; state: string; error: string | null; transcript: Transcript | null } | null;
export function TranscriptView({ reviewId }: { reviewId: string }) {
  const audio = useRef<HTMLAudioElement>(null); const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['transcript', reviewId], queryFn: () => api<State>(`/api/reviews/${reviewId}/transcript`), structuralSharing:(previous,next)=>{const old=previous as State|undefined,value=next as State;return old&&value&&old.revision>value.revision?old:value;}, refetchInterval: query => !query.state.data || ['queued', 'encoding', 'submitting'].includes(query.state.data.state) ? 2000 : false });
  if (query.error&&!query.data) return <p role="alert">Unable to load the transcript. Reload to retry.</p>;
  const state = query.data;
  if (!state || ['queued', 'encoding', 'submitting'].includes(state.state)) return <p role="status" className="mt-4">Transcribing and identifying speakers… You can leave and return later.</p>;
  if (state.state !== 'ready' || !state.transcript) return <p role="alert" className="mt-4">{state.error ?? 'Transcription is unavailable.'}</p>;
  const utterances = state.transcript.utterances; const visible = utterances.slice(page * 100, (page + 1) * 100);
  return <section className="mt-6 space-y-4" aria-labelledby="transcript-heading">
    <h3 id="transcript-heading" className="font-semibold">Transcript</h3>
    <p className="text-sm text-muted-foreground">Machine transcription may contain errors. Speaker labels are unconfirmed. Confirm your voice before coaching. Confidence scores and word-level timing are not provided by this model.</p>
    {query.error&&<p role="alert">Unable to refresh the transcript. Open corrections are preserved.</p>}
    {state.parentId&&<RefreshCorrectedAnalysis reviewId={reviewId} transcriptId={state.id}/>}
    <SpeakerConfirmation reviewId={reviewId} transcriptId={state.id} transcript={state.transcript} />
    <QuestionThreads reviewId={reviewId} />
    <audio ref={audio} controls preload="none" src={`/api/reviews/${reviewId}/audio`} aria-label="Transcript passage playback" />
    {!utterances.length && <p>No speech was detected. Listen to your recording to check it.</p>}
    <ol className="space-y-4">{visible.map(utterance => <li key={utterance.id} className="rounded-md border p-3">
      <Button variant="ghost" onClick={() => { if (audio.current) { audio.current.currentTime = utterance.startMs / 1000; void audio.current.play().catch(() => {}); } }} aria-label={`Play passage at ${Math.floor(utterance.startMs / 60000)} minutes ${Math.floor(utterance.startMs / 1000) % 60} seconds`}>{Math.floor(utterance.startMs / 60000)}:{String(Math.floor(utterance.startMs / 1000) % 60).padStart(2, '0')}</Button>
      <span className="text-sm font-medium">{utterance.speaker ? `Speaker ${utterance.speaker}` : 'Unidentified speaker'}</span>
      {utterance.overlap && <span className="ml-2 text-sm">Overlapping speech — check the audio</span>}
      <p className="mt-2 whitespace-pre-wrap">{utterance.text}</p>{utterance.corrected&&<p className="text-sm">Candidate-corrected wording · original audio range retained</p>}
      <TranscriptCorrection reviewId={reviewId} transcriptId={state.id} revision={state.revision} utterance={utterance}/>
    </li>)}</ol>
    {utterances.length > 100 && <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous passages</Button><span>Page {page + 1} of {Math.ceil(utterances.length / 100)}</span><Button variant="outline" disabled={(page + 1) * 100 >= utterances.length} onClick={() => setPage(page + 1)}>Next passages</Button></div>}
  </section>;
}
