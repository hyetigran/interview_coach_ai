import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const image = process.argv[2];
const chunkCompression = process.argv.includes('--chunk-compression');
const longCompression = chunkCompression || process.argv.includes('--long-compression');
if (!image) throw new Error('Usage: node scripts/test-media-container.mjs IMAGE');
const directory = await mkdtemp(join(tmpdir(), 'coach-container-test-'));
const secret = randomBytes(32).toString('hex');
let container;
try {
  const envFile = join(directory, 'container.env');
  await writeFile(envFile, `AUTH_SECRET=${secret}\n`, { mode: 0o600 });
  container = execFileSync('docker', ['run', '--detach', '--rm', '--platform', 'linux/amd64', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=1g', '--cpus=0.25', '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m', '--publish', '127.0.0.1::8790', '--env-file', envFile, image], { encoding: 'utf8' }).trim();
  const port = execFileSync('docker', ['port', container, '8790/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${secret}` };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(origin + '/health', { headers, signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await setTimeout(100);
  }
  if (!ready) console.error(execFileSync('docker', ['logs', container], {encoding:'utf8'}));
  assert.ok(ready, 'container did not become ready');
  assert.equal((await fetch(origin + '/health')).status, 403);
  assert.equal((await fetch(origin + '/health', { headers: { ...headers, origin: 'https://untrusted.example' } })).status, 403);
  assert.notEqual(execFileSync('docker', ['exec', container, 'id', '-u'], { encoding: 'utf8' }).trim(), '0');
  const operation = '/operations/prepare-00000000-0000-0000-0000-000000000000';
  for (const [extension, video, audio, seconds] of (longCompression ? [] : [['mp4', 'libx264', 'aac', 3600], ['mp4', 'libx264', 'aac', 3601], ['mov', 'libx264', 'aac', 1], ['webm', 'libvpx', 'libopus', 1], ['webm', 'libvpx-vp9', 'libopus', 1]])) {
    const source = join(directory, `source.${extension}`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=size=32x32:rate=1:duration=${seconds}`, '-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono:d=${seconds}`, '-c:v', video, '-c:a', audio, '-shortest', '-y', source], { timeout: 60000 });
    const response = await fetch(origin + operation, { method: 'POST', headers, body: await readFile(source), signal: AbortSignal.timeout(85000) });
    if (seconds > 3600) {
      assert.equal(response.status, 422);
      await response.arrayBuffer();
    } else {
      assert.equal(response.status, 200, response.ok ? undefined : (await response.text()).slice(0, 200));
      let size = 0;
      const header = Buffer.alloc(44);
      for await (const chunk of response.body) {
        if (size < 44) header.set(chunk.subarray(0, 44 - size), size);
        size += chunk.byteLength;
      }
      assert.equal(header.toString('ascii', 8, 12), 'WAVE');
      assert.equal(header.readUInt32LE(24), 16000);
      if (seconds === 3600) assert.equal(size, 3600 * 32000 + 44);
      else assert.ok(size >= 31000 && size <= 35000);
    }
    console.log(`Verified ${extension}/${video}/${audio}: ${seconds}s`);
  }
  const source = join(directory, 'speech.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${longCompression ? 3600 : 1}`, '-ar', '16000', '-ac', '1', source]);
  const compressed = await fetch(origin + '/compression/transcript-prepare-00000000-0000-0000-0000-000000000000-attempt-1', { method: 'POST', headers: {...headers,...(chunkCompression?{'x-transcription-parts':'1'}:{})}, body: await readFile(source), signal: AbortSignal.timeout(85000) });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get('content-type'), chunkCompression?'application/vnd.interview-coach.transcription-parts':'audio/mpeg');
  const compressedBody=Buffer.from(await compressed.arrayBuffer());
  const compressedSize = compressedBody.byteLength;
  if(chunkCompression){
    const headerLength=compressedBody.readUInt32BE(0),manifest=JSON.parse(compressedBody.subarray(4,4+headerLength).toString());
    assert.equal(manifest.version,1);
    assert.deepEqual(manifest.chunks.map(({offsetMs,durationMs})=>({offsetMs,durationMs})),[0,1200000,2400000].map(offsetMs=>({offsetMs,durationMs:1200000})));
    let cursor=4+headerLength,decodedBytes=0;
    for(const part of manifest.chunks){
      const file=join(directory,`part-${part.index}.mp3`),raw=join(directory,`part-${part.index}.pcm`);
      await writeFile(file,compressedBody.subarray(cursor,cursor+part.bytes));cursor+=part.bytes;
      execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar','16000','-f','s16le',raw],{timeout:30000});
      decodedBytes+=(await stat(raw)).size;
    }
    assert.equal(cursor,compressedSize);assert.equal(decodedBytes,3600*32000);
    console.log('Verified three independently decoded parts with complete hour-long sample coverage.');
  }
  assert.ok(compressedSize > 0 && compressedSize < 15000000);
  console.log(`Verified ${longCompression ? 3600 : 1}s compression: ${compressedSize} bytes`);
  const invalid = await fetch(origin + operation, { method: 'POST', headers, body: 'corrupt recording' });
  assert.equal(invalid.status, 422);
  await invalid.arrayBuffer();
  console.log('Verified authentication, browser-origin denial, non-root execution, compression and corrupt-file rejection.');
} finally {
  try { if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
