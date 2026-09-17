'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { MAX_AUDIO_BYTES, PART_BYTES, type MediaState, type UploadState } from '@/lib/media/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function AudioUpload({ reviewId, ownerId }: { reviewId: string; ownerId: string }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const path = `/api/reviews/${reviewId}`;
  const queryKey = ['media', ownerId, reviewId];
  const state = useQuery({ queryKey, queryFn: () => api<MediaState>(path + '/media'), refetchInterval: query => ['initializing', 'completing'].includes(query.state.data?.upload?.state ?? '') ? 2000 : false });
  const current = state.data?.upload;
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Select your WAV recording.');
      if (file.size > MAX_AUDIO_BYTES) throw new Error('The file exceeds 256 MiB.');
      abort.current = new AbortController(); const signal = abort.current.signal;
      const latest = await api<MediaState>(path + '/media');
      const active = latest.upload && latest.upload.state !== 'cleanup' ? latest.upload : null;
      if (active?.state === 'admitted') return;
      if (active && (active.size !== file.size || active.name !== file.name)) throw new Error('Select the original file to resume this upload.');
      const session = active ?? await api<UploadState>(path + '/media', { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, actionId: crypto.randomUUID() }) });
      if (session.state === 'initializing') throw new Error('Upload is starting. Try again shortly.');
      if (session.state === 'completing') { await api(path + `/uploads/${session.id}/complete`, { method: 'POST', body: '{}' }); return; }
      for (let number = 1; number <= Math.ceil(file.size / PART_BYTES); number++) {
        signal.throwIfAborted();
        const bytes = await file.slice((number - 1) * PART_BYTES, number * PART_BYTES).arrayBuffer();
        const saved = session.parts.find(p => p.number === number);
        if (saved) {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          if (hash !== saved.sha256) throw new Error('This file differs from the original upload. Select the original file.');
        } else {
          const { token } = await api<{ token: string }>(path + `/uploads/${session.id}/parts/${number}/sign`, { method: 'POST', body: '{}', signal });
          await api(path + `/uploads/${session.id}/parts/${number}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-part-capability': token }, body: bytes, signal });
        }
        setProgress(Math.min(number * PART_BYTES, file.size));
      }
      await api(path + `/uploads/${session.id}/complete`, { method: 'POST', body: '{}', signal });
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  const savedBytes = current?.parts.reduce((sum, part) => sum + Math.min(PART_BYTES, current.size - (part.number - 1) * PART_BYTES), 0) ?? 0;
  return <section className="my-8 rounded-xl border p-6" aria-labelledby="recording-heading">
    <h2 id="recording-heading" className="font-medium">Interview recording</h2>
    <p className="mt-2 text-sm text-muted-foreground">WAV audio, PCM 16-bit, mono or stereo, 8–48 kHz, with a standard 44-byte header. Maximum 256 MiB and 60 minutes. Your recording stays private and is retained until you delete this review.</p>
    {state.data && <p className="mt-2 text-sm">{state.data.admitted} of {state.data.allowance} recording admissions used; {state.data.reserved} reserved. Deleting a recording does not restore an admission.</p>}
    {state.isPending && <p role="status" className="mt-4">Loading recording…</p>}
    {state.error && <p role="alert" className="mt-4">{state.error.message}</p>}
    {current?.state === 'admitted' ? <div className="mt-4"><p className="mb-3">{current.name}</p><audio controls preload="metadata" src={path + '/audio'} aria-label="Private interview recording" /><p className="mt-3 text-sm text-muted-foreground">Recording saved. Transcript processing is coming in the next update.</p></div> : <>
      {current?.state === 'cleanup' && <p role="status" className="mt-4">The previous upload expired, was invalid, or was cancelled. Select a WAV file to start again; its unused reservation has been released.</p>}
      {current?.state === 'uploading' && <p className="mt-4">Saved {Math.round(savedBytes / current.size * 100)}% of {current.name}. Reselect the original file to resume. Upload expires {new Date(current.expiresAt).toLocaleString()}.</p>}
      {current?.state === 'completing' && <p role="status" className="mt-4">Checking your recording. If this was interrupted, reselect the file and retry after one minute.</p>}
      <div className="mt-4 space-y-3"><Label htmlFor="audio-file">WAV recording</Label><Input id="audio-file" type="file" accept=".wav,audio/wav" disabled={upload.isPending} onChange={event => { setFile(event.target.files?.[0] ?? null); setProgress(0); upload.reset(); }} />
        <Button disabled={!file || upload.isPending || state.isPending} onClick={() => upload.mutate()}>{upload.isPending ? 'Uploading…' : current && current.state !== 'cleanup' ? 'Resume upload' : 'Upload recording'}</Button>
        {upload.isPending && <Button variant="outline" className="ml-3" onClick={() => abort.current?.abort()}>Pause upload</Button>}
        {upload.isPending && file && <p role="status">{Math.round(progress / file.size * 100)}% uploaded</p>}
        {upload.error && <p role="alert">{upload.error.name === 'AbortError' ? 'Upload paused. Reselect the original file after a reload to resume.' : upload.error.message}</p>}
      </div>
    </>}
  </section>;
}
