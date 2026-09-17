import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';

const MAX_BYTES = 256 * 1024 * 1024;
function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill('SIGKILL'); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error('The recording could not be decoded. Export it again as MP4 with H.264 video and AAC audio.')));
  });
}

export async function extractAudio(source, directory, signal) {
  const input = ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-i', source];
  const probe = JSON.parse(await run('ffprobe', [...input, '-show_entries', 'format=duration,start_time:stream=codec_type,codec_name,start_time,duration', '-of', 'json'], signal));
  const audio = probe.streams?.filter(stream => stream.codec_type === 'audio') ?? [];
  const video = probe.streams?.filter(stream => stream.codec_type === 'video') ?? [];
  if (!audio.length) throw new Error('This recording has no audio track. Export the interview with audio enabled.');
  if (audio.length !== 1 || !['aac', 'opus'].includes(audio[0].codec_name) || !video.length || video.some(stream => !['h264', 'vp8', 'vp9'].includes(stream.codec_name))) throw new Error('Use MP4/MOV with H.264 and AAC, or WebM with VP8/VP9 and Opus, with one audio track.');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('Recordings must contain audio and be no longer than 60 minutes.');
  const start = Number(probe.format.start_time ?? 0);
  if (!Number.isFinite(start)) throw new Error('The recording timeline could not be read. Export the recording again.');
  const raw = join(directory, 'audio.pcm');
  // Keep original presentation timestamps relative to the container start. Fill audio gaps with silence.
  await run('ffmpeg', [...input.slice(0, -2), '-copyts', '-i', source, '-map', '0:a:0', '-vn', '-af', `asetpts=PTS-(${start})/TB,aresample=16000:async=1:first_pts=0`, '-ac', '1', '-ar', '16000', '-t', '3600.01', '-f', 's16le', '-y', raw], signal);
  const bytes = (await stat(raw)).size;
  if (!bytes || bytes > 3600 * 32000) throw new Error('Decoded audio must be no longer than 60 minutes.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(bytes + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes, 40);
  const target = join(directory, 'audio.wav'); await writeFile(target, header);
  await pipeline(createReadStream(raw), createWriteStream(target, { flags: 'a' }), { signal });
  return { target, bytes: bytes + 44 };
}

export function mediaServer(secret, temporaryRoot = tmpdir()) {
  const operations = new Map();
  return createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || request.headers.origin) { response.writeHead(403).end(); return; }
    if (request.url === '/health' && request.method === 'GET') { response.end('Local media adapter ready'); return; }
    const id = /^\/operations\/(prepare-[a-f0-9-]{36})$/.exec(request.url ?? '')?.[1];
    if (!id) { response.writeHead(404).end(); return; }
    if (request.method === 'DELETE') { operations.get(id)?.abort(); response.writeHead(204).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    if (operations.has(id) || operations.size >= 2) { response.writeHead(409).end('Media preparation is busy. Retry shortly.'); return; }
    const controller = new AbortController(); operations.set(id, controller);
    const timer = setTimeout(() => controller.abort(), 75000);
    const directory = await mkdtemp(join(temporaryRoot, 'interviewcoach-media-'));
    response.on('close', () => { if (!response.writableFinished) controller.abort(); });
    try {
      let observed = 0;
      const bounded = new Transform({ transform(chunk, _encoding, callback) { observed += chunk.length; callback(observed > MAX_BYTES ? new Error('Recording exceeds 256 MiB.') : null, chunk); } });
      const source = join(directory, 'source');
      await pipeline(request, bounded, createWriteStream(source, { mode: 0o600 }), { signal: controller.signal });
      const result = await extractAudio(source, directory, controller.signal);
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(result.bytes), 'Cache-Control': 'no-store' });
      await pipeline(createReadStream(result.target), response, { signal: controller.signal });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.writeHead(422).end(controller.signal.aborted ? 'Media preparation timed out or was cancelled.' : error.message);
    } finally { clearTimeout(timer); operations.delete(id); await rm(directory, { recursive: true, force: true }); }
  });
}

if (process.argv[1]?.endsWith('/media-adapter.mjs')) {
  const vars = await readFile('.dev.vars', 'utf8');
  const secret = /^AUTH_SECRET=(.+)$/m.exec(vars)?.[1];
  if (!secret) throw new Error('Run pnpm setup:local first.');
  const temporaryRoot = join(process.cwd(), '.wrangler', 'media-temporary');
  const server = mediaServer(secret.trim(), temporaryRoot);
  server.listen(8790, '127.0.0.1', async () => {
    // A successful exclusive listen ensures no other adapter uses these scratch files.
    await rm(temporaryRoot, { recursive: true, force: true }); await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    console.log('Local media adapter ready on port 8790');
  });
  process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
}
