import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const MAX_BYTES = 256 * 1024 * 1024;
function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {signal,stdio:['ignore','ignore','ignore'],env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('YouTube import failed. The video may be unavailable, restricted, too large, or longer than 60 minutes.')));
  });
}

export async function importYoutube(input, directory, signal, execute = run) {
  if (!input || Object.keys(input).some(key => !['videoId','endSeconds'].includes(key)) || !/^[A-Za-z0-9_-]{11}$/.test(input.videoId ?? '') ||
      (input.endSeconds != null && (!Number.isInteger(input.endSeconds) || input.endSeconds < 1 || input.endSeconds > 3600))) throw new Error('Invalid YouTube import.');
  const source = join(directory, 'youtube.m4a');
  // Canonical ID only; no user URLs, shell, cookies, plugins, config, or playlists.
  await execute(process.env.YT_DLP_PATH || 'yt-dlp', [
    '--ignore-config','--no-plugin-dirs','--no-cache-dir','--no-playlist','--no-progress','--no-warnings',
    '--no-js-runtimes','--js-runtimes',`node:${process.execPath}`,
    '--use-extractors','youtube','--socket-timeout','15','--retries','0','--fragment-retries','0',
    '--match-filters','!is_live & duration > 0 & duration <= 3600',
    '--max-filesize',String(MAX_BYTES),'-f','bestaudio[ext=m4a][protocol=https]',
    '-o',source,'--',`https://www.youtube.com/watch?v=${input.videoId}`,
  ], signal);
  const size = (await stat(source)).size;
  if (!size || size > MAX_BYTES) throw new Error('The YouTube audio exceeds 256 MiB.');
  const raw = join(directory, 'audio.pcm');
  // Local input only. +0.01 exposes over-duration audio instead of silently truncating it.
  await execute('ffmpeg', ['-v','error','-protocol_whitelist','file','-format_whitelist','mov','-i',source,
    '-map','0:a:0','-vn','-ac','1','-ar','16000','-t',String(input.endSeconds ?? 3600.01),'-f','s16le','-y',raw], signal);
  const bytes = (await stat(raw)).size;
  if (!bytes || bytes > 3600 * 32000 || (input.endSeconds != null && bytes > input.endSeconds * 32000)) throw new Error('Imported audio exceeds the requested duration.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(bytes+36,4); header.write('WAVEfmt ',8); header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(16000,24); header.writeUInt32LE(32000,28);
  header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(bytes,40);
  const target = join(directory,'audio.wav'); await writeFile(target,header,{mode:0o600});
  await pipeline(createReadStream(raw),createWriteStream(target,{flags:'a'}),{signal});
  return {target,bytes:bytes+44};
}
