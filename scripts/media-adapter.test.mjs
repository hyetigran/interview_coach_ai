import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAudio, mediaServer } from './media-adapter.mjs';

for (const [extension, video, audio] of [['mp4', 'libx264', 'aac'], ['mov', 'libx264', 'aac'], ['webm', 'libvpx', 'libopus'], ['webm', 'libvpx-vp9', 'libopus']]) {
  test(`extracts real ${extension}/${video}/${audio} into PCM playback`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coach-format-test-'));
    try {
      const source = join(directory, 'source.' + extension);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=5:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', video, '-c:a', audio, '-shortest', source]);
      const result = await extractAudio(source, directory, AbortSignal.timeout(15000));
      const bytes = await readFile(result.target);
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE'); assert.equal(bytes.readUInt32LE(24), 16000);
      assert.ok(bytes.length > 31000 && bytes.length < 35000);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
test('rejects corrupt and no-audio recordings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coach-bad-format-'));
  try {
    const source = join(directory, 'source.mp4'); await writeFile(source, 'invalid');
    await assert.rejects(extractAudio(source, directory, AbortSignal.timeout(15000)), /decoded/);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=5:duration=1', '-c:v', 'libx264', '-y', source]);
    await assert.rejects(extractAudio(source, directory, AbortSignal.timeout(15000)), /no audio track/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('local adapter requires its secret and rejects browser origins', async () => {
  const server = mediaServer('test-secret'); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/health`;
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer test-secret', origin: 'http://evil.example' } })).status, 403);
    assert.equal(await (await fetch(url, { headers: { authorization: 'Bearer test-secret' } })).text(), 'Local media adapter ready');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('scratch directory failure responds without leaking the operation slot', async () => {
  const server = mediaServer('test-secret', '/missing/interview-coach-scratch');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/operations/prepare-00000000-0000-0000-0000-000000000000`;
    for (let n = 0; n < 2; n++) assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'Bearer test-secret' }, body: 'video' })).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('attempt-specific compression routes process real audio', async () => {
 const directory=await mkdtemp(join(tmpdir(),'coach-retry-compression-'));
 const server=mediaServer('test-secret');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const source=join(directory,'source.wav');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-ar','16000','-ac','1',source]);
  for(const suffix of ['','-attempt-1','-attempt-2']) {
   const response=await fetch(`http://127.0.0.1:${server.address().port}/compression/transcript-prepare-00000000-0000-0000-0000-000000000000${suffix}`,{method:'POST',headers:{authorization:'Bearer test-secret'},body:await readFile(source)});
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.ok((await response.arrayBuffer()).byteLength>0);
  }
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
