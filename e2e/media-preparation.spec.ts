import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerInvited} from './register-invited';
import {testOrigin, invitationFlags, storageFlags, mediaBucket} from './test-target';

type MediaCase = {name:string; seconds:number; extension:string; video:string; audio?:string; error?:RegExp; corrupt?:boolean; boundary?:boolean};
const cases: MediaCase[] = [
  ...[3600,3601].map(seconds => ({name:`video preparation enforces the ${seconds}-second boundary`,seconds,extension:'mp4',video:'libx264',audio:'aac',boundary:true,error:seconds>3600?/60 minutes/:undefined})),
  {name:'MOV with H.264 and AAC',seconds:1,extension:'mov',video:'libx264',audio:'aac'},
  {name:'WebM with VP8 and Opus',seconds:1,extension:'webm',video:'libvpx',audio:'libopus'},
  {name:'WebM with VP9 and Opus',seconds:1,extension:'webm',video:'libvpx-vp9',audio:'libopus'},
  {name:'video without audio',seconds:1,extension:'mp4',video:'libx264',error:/no audio track/},
  {name:'unsupported video codec',seconds:1,extension:'mp4',video:'mpeg4',audio:'aac',error:/Use MP4\/MOV with H.264 and AAC/},
  {name:'corrupt video',seconds:1,extension:'mp4',video:'libx264',corrupt:true,error:/could not be decoded/},
];

for (const sample of cases) {
  test(sample.name, async ({page, context}) => {
    // Explicit opt-in: deployed cases start paid preparation and may start transcription.
    test.skip((sample.boundary ? process.env.E2E_MEDIA_BOUNDARY : process.env.E2E_MEDIA_FORMATS) !== '1', 'Enable the boundary or format media checks explicitly.');
    test.setTimeout(360000);
    const folder = mkdtempSync(join(tmpdir(), 'coach-media-boundary-'));
    let endpoint: string | undefined;
    try {
      const source = join(folder, 'recording.' + sample.extension);
      if (sample.corrupt) writeFileSync(source, Buffer.alloc(100));
      else execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=size=32x32:rate=1:duration=${sample.seconds}`,
        ...(sample.audio ? ['-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono:d=${sample.seconds}`] : []),
        '-c:v', sample.video, ...(sample.audio ? ['-c:a', sample.audio, '-shortest'] : []), source], {timeout:60000});
      const email = `boundary-${randomUUID()}@example.com`;
      const invitation = execFileSync('node', ['scripts/invite.mjs', email, ...invitationFlags], {encoding:'utf8'}).trim().split('\n').at(-1)!;
      const signup = await registerInvited(context.request, {headers:{origin:testOrigin, 'x-invitation-token':invitation},
        data:{name:'Synthetic Boundary Test', email, password:randomUUID()+randomUUID()}});
      expect(signup.ok()).toBeTruthy();
      const created = await context.request.post('/api/reviews', {headers:{origin:testOrigin}, data:{title:`Synthetic ${sample.name}`, role:'Engineer', origin:'mock'}});
      expect(created.ok()).toBeTruthy();
      const review = await created.json();
      endpoint = `/api/reviews/${review.id}`;
      await page.goto(`/reviews/${review.id}`);
      await expect(page.getByLabel('Interview recording file', {exact:true})).toBeEnabled();
      await page.getByLabel('Interview recording file', {exact:true}).setInputFiles(source);
      const initiated = page.waitForResponse(response => new URL(response.url()).pathname === endpoint + '/media' && response.request().method() === 'POST');
      await page.getByRole('button', {name:'Upload recording', exact:true}).click();
      const initiation = await initiated;
      expect(initiation.status(), 'Recording upload initiation').toBe(200);
      const upload = await initiation.json();
      const processing = endpoint + '/processing';
      await expect.poll(async () => (await (await context.request.get(processing)).json())?.state,
        {timeout:240000, intervals:[1000, 3000, 5000]}).toBe(sample.error ? 'failed' : 'ready');
      const state = await (await context.request.get(processing)).json();
      await page.reload();
      const retained = join(folder, 'retained.' + sample.extension);
      execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'get', `${mediaBucket}/originals/${upload.id}`, ...storageFlags, '--file', retained], {stdio:'pipe', timeout:60000});
      const hash = (path:string) => createHash('sha256').update(readFileSync(path)).digest('hex');
      expect(hash(retained)).toBe(hash(source));
      if (!sample.error) {
        await expect(page.getByText('Recording prepared', {exact:true})).toBeVisible();
        expect(state.result).toMatchObject({sampleRate:16000, channels:1, originalTimeOffsetMs:0});
        if (sample.boundary) expect(state.result).toMatchObject({durationMs:3600000, bytes:115200044});
        else {
          expect(state.result.durationMs).toBeGreaterThanOrEqual(950);
          expect(state.result.durationMs).toBeLessThanOrEqual(1100);
          expect(state.result.bytes).toBeGreaterThan(31000);
          expect(state.result.bytes).toBeLessThan(35500);
        }
        expect(state.result.audioKey).not.toBe(state.result.sourceKey);
        expect(state.result.sourceKey).toBe(`originals/${upload.id}`);
        const last = state.result.bytes - 1;
        const tail = await context.request.get(endpoint + '/audio', {headers:{range:`bytes=${last-1}-${last}`}});
        expect(tail.status()).toBe(206);
        expect(tail.headers()['content-range']).toBe(`bytes ${last-1}-${last}/${state.result.bytes}`);
        expect((await tail.body()).byteLength).toBe(2);
        const audio = page.getByLabel('Private interview recording');
        await expect(audio).toBeVisible();
        if (sample.boundary) await expect.poll(() => audio.evaluate((element:HTMLAudioElement) => element.duration)).toBe(3600);
        else await expect.poll(() => audio.evaluate((element:HTMLAudioElement) => element.duration)).toBeCloseTo(state.result.durationMs/1000, 2);
      } else {
        expect(state.error).toMatch(sample.error);
        await expect(page.getByRole('alert').filter({hasText:sample.error})).toBeVisible();
        expect(state.retry.canRetry).toBe(false);
        expect(state.result).toBeNull();
        expect((await context.request.get(endpoint + '/audio')).status()).toBe(404);
      }
      expect([202, 204]).toContain((await context.request.delete(endpoint, {headers:{origin:testOrigin}, data:{}})).status());
      expect((await context.request.get(endpoint + '/audio')).status()).toBe(404);
      expect((await context.request.get(processing)).status()).toBe(404);
      await expect.poll(async () => (await (await context.request.get(endpoint + '/deletion')).json()).cleanupPending,
        {timeout:90000, intervals:[1000, 5000]}).toBe(false);
    } finally {
      if (endpoint) await context.request.delete(endpoint, {headers:{origin:testOrigin}, data:{}, timeout:10000}).catch(() => {});
      rmSync(folder, {recursive:true, force:true});
    }
  });
}
