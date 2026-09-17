'use client';
import {FutureAnswerEditor} from './saved-preparation';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useRef} from 'react';
import {api} from '@/lib/api';
import type {CoachingResult} from '@/lib/coaching';
import {Button} from './ui/button';
type Retry={jobId:string;attempt:number;canRetry:boolean;reason:string;maximumUnits:number;reuseDraft:boolean};
type State={state:string;error?:string|null;jobs:{retry?:Retry|null;id:string;threadId:string;state:string;error:string|null;result:CoachingResult|null}[]}|null;
export function CoachingCard({reviewId,threadId}:{reviewId:string;threadId:string}) {
 const client=useQueryClient(),action=useRef<{target:string;id:string}|null>(null);
 const retry=useMutation({mutationFn:(plan:Retry)=>{
  const target=plan.jobId+':'+plan.attempt;if(action.current?.target!==target)action.current={target,id:crypto.randomUUID()};
  return api(`/api/reviews/${reviewId}/coaching`,{method:'PATCH',body:JSON.stringify({actionId:action.current.id,jobId:plan.jobId,attempt:plan.attempt})});
 },onSettled:()=>client.invalidateQueries({queryKey:['coaching',reviewId]})});
 const audio=useRef<HTMLAudioElement>(null);
 const query=useQuery({queryKey:['coaching',reviewId],queryFn:()=>api<State>(`/api/reviews/${reviewId}/coaching`),refetchInterval:q=>!q.state.data||['queued','running'].includes(q.state.data.state)?3000:false});
 if(query.error)return <p role="alert">Unable to load coaching. Reload to retry.</p>;
 const state=query.data;if(!state)return <p role="status">Coaching will follow question grouping.</p>;
 const job=state.jobs.find(j=>j.threadId===threadId);if(!job)return <p role="status">{['queued','running'].includes(state.state)?'Coaching is waiting for its processing slot or preparing this thread.':state.error??'No coaching result is available for this thread.'}</p>;
 if(['queued','preparing','generating','verifying','publishing'].includes(job.state))return <p role="status">Preparing and checking supported coaching… You can leave and return.</p>;
 if(!job.result)return <div className="space-y-2"><p role="status">{job.error??'Coaching is unavailable for this thread. The original evidence remains accessible.'}</p>{job.retry&&<p>{job.retry.reason}</p>}{job.retry?.canRetry&&<><p>This retry reserves ${(job.retry.maximumUnits/1000000).toFixed(2)} from the shared allowance.</p><Button disabled={retry.isPending} onClick={()=>retry.mutate(job.retry!)}>{retry.isPending?'Queuing retry…':job.retry.reuseDraft?'Retry support check':'Retry coaching'}</Button></>}{retry.error&&<p role="alert">{retry.error.message}</p>}</div>;
 const result=job.result;
 return <section className="space-y-3 rounded-md bg-muted p-3" aria-label="Coaching suggestion">
  {state.state==='outdated'&&<p role="status">Earlier advice: its source evidence changed. This saved result remains readable, but reanalysis is needed before using it.</p>}
  <h4 className="font-semibold">{result.outcome==='preserve'?'Keep this strength':result.outcome==='improve'?'Suggested improvement':'Facts needed before a suggestion'}</h4>
  <p>{result.rationale}</p>
  {result.segments.length>0&&<><h5 className="font-medium">{result.segments.some(s=>s.kind==='alternative')?'Alternative story for a future answer':'Proposed future answer'}</h5><p className="whitespace-pre-wrap">{result.segments.map(s=>s.text).join(' ')}</p><h5 className="font-medium">Supporting evidence</h5>
   <audio ref={audio} controls preload="none" src={`/api/reviews/${reviewId}/audio`} aria-label="Coaching evidence playback" />
   <ul className="space-y-2">{result.segments.map((segment,i)=><li key={i}>{segment.citations.map((cite,j)=><blockquote key={j}><p>{cite.quote}</p>{'contextId' in cite?<p className="text-sm">New material from {cite.label.toLowerCase()} — context version {cite.contextId.split(':').at(-1)}. This was not recorded interview speech.</p>:<><p className="text-sm">From the recorded interview</p><Button variant="ghost" onClick={()=>{if(audio.current){audio.current.currentTime=cite.startMs/1000;void audio.current.play().catch(()=>{});}}}>Listen to supporting passage at {Math.floor(cite.startMs/60000)}:{String(Math.floor(cite.startMs/1000)%60).padStart(2,'0')}</Button></>}</blockquote>)}</li>)}</ul></>}
  {result.missingFacts.length>0&&<div><h5 className="font-medium">Questions to fill the gaps</h5><ul>{result.missingFacts.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}
  {result.limitations.map((text,i)=><p key={i}>{text}</p>)}
  <FutureAnswerEditor reviewId={reviewId} jobId={job.id} proposal={result.segments.map(s=>s.text).join(' ')} />
  <p className="text-sm text-muted-foreground">The original answer is shown above. This is a proposed future answer, not a transcript correction. Matching citations and automated support checks do not establish substantive correctness; coaching quality has not yet been independently evaluated.</p>
 </section>;
}
