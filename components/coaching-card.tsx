'use client';
import {useQuery} from '@tanstack/react-query';
import {useRef} from 'react';
import {api} from '@/lib/api';
import type {CoachingResult} from '@/lib/coaching';
import {Button} from './ui/button';
type State={state:string;jobs:{id:string;threadId:string;state:string;error:string|null;result:CoachingResult|null}[]}|null;
export function CoachingCard({reviewId,threadId}:{reviewId:string;threadId:string}) {
 const audio=useRef<HTMLAudioElement>(null);
 const query=useQuery({queryKey:['coaching',reviewId],queryFn:()=>api<State>(`/api/reviews/${reviewId}/coaching`),refetchInterval:q=>!q.state.data||q.state.data.state==='running'?3000:false});
 if(query.error)return <p role="alert">Unable to load coaching. Reload to retry.</p>;
 const state=query.data;if(!state)return <p role="status">Coaching will follow question grouping.</p>;
 if(state.state==='outdated')return <p role="status">The source changed. This advice is outdated; reanalysis is needed before using it.</p>;
 const job=state.jobs.find(j=>j.threadId===threadId);if(!job)return <p>No coaching result is available for this thread.</p>;
 if(['queued','preparing','generating','verifying'].includes(job.state))return <p role="status">Preparing and checking supported coaching… You can leave and return.</p>;
 if(!job.result)return <p role="status">{job.error??'Coaching is unavailable for this thread. The original evidence remains accessible.'}</p>;
 const result=job.result;
 return <section className="space-y-3 rounded-md bg-muted p-3" aria-label="Coaching suggestion">
  <h4 className="font-semibold">{result.outcome==='preserve'?'Keep this strength':result.outcome==='improve'?'Suggested improvement':'Facts needed before a suggestion'}</h4>
  <p>{result.rationale}</p>
  {result.segments.length>0&&<><h5 className="font-medium">Proposed future answer</h5><p className="whitespace-pre-wrap">{result.segments.map(s=>s.text).join(' ')}</p><h5 className="font-medium">Supporting interview evidence</h5>
   <audio ref={audio} controls preload="none" src={`/api/reviews/${reviewId}/audio`} aria-label="Coaching evidence playback" />
   <ul className="space-y-2">{result.segments.map((segment,i)=><li key={i}>{segment.citations.map((cite,j)=><blockquote key={j}><p>{cite.quote}</p><Button variant="ghost" onClick={()=>{if(audio.current){audio.current.currentTime=cite.startMs/1000;void audio.current.play().catch(()=>{});}}}>Listen to supporting passage at {Math.floor(cite.startMs/60000)}:{String(Math.floor(cite.startMs/1000)%60).padStart(2,'0')}</Button></blockquote>)}</li>)}</ul></>}
  {result.missingFacts.length>0&&<div><h5 className="font-medium">Questions to fill the gaps</h5><ul>{result.missingFacts.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}
  {result.limitations.map((text,i)=><p key={i}>{text}</p>)}
  <p className="text-sm text-muted-foreground">The original answer is shown above. This is a proposed future answer, not a transcript correction. Matching citations and automated support checks do not establish substantive correctness; coaching quality has not yet been independently evaluated.</p>
 </section>;
}
