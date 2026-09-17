import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerInvited} from './register-invited';
import {testOrigin, invitationFlags, storageFlags, mediaBucket} from './test-target';

// Explicit opt-in: a deployed run starts paid media preparation and may start transcription.
test.skip(process.env.E2E_MEDIA_BOUNDARY !== '1', 'Set E2E_MEDIA_BOUNDARY=1 to exercise real hour-long media.');

for (const seconds of [3600, 3601]) {
  test(`video preparation enforces the ${seconds}-second boundary`, async ({page, context}) => {
    test.setTimeout(360000);
    const folder = mkdtempSync(join(tmpdir(), 'coach-media-boundary-'));
    let endpoint: string | undefined;
    try {
      const source = join(folder, 'boundary.mp4');
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=size=32x32:rate=1:duration=${seconds}`,
        '-f', 'lavfi', '-i', `anullsrc=r=16000:cl=mono:d=${seconds}`, '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source], {timeout:60000});
      const email = `boundary-${randomUUID()}@example.com`;
      const invitation = execFileSync('node', ['scripts/invite.mjs', email, ...invitationFlags], {encoding:'utf8'}).trim().split('\n').at(-1)!;
      const signup = await registerInvited(context.request, {headers:{origin:testOrigin, 'x-invitation-token':invitation},
        data:{name:'Synthetic Boundary Test', email, password:randomUUID()+randomUUID()}});
      expect(signup.ok()).toBeTruthy();
      const created = await context.request.post('/api/reviews', {headers:{origin:testOrigin}, data:{title:`Synthetic ${seconds}s video`, role:'Engineer', origin:'mock'}});
      expect(created.ok()).toBeTruthy();
      const review = await created.json();
      endpoint = `/api/reviews/${review.id}`;
      await page.goto(`/reviews/${review.id}`);
      await page.getByLabel('Interview recording file', {exact:true}).setInputFiles(source);
      const initiated = page.waitForResponse(response => new URL(response.url()).pathname === endpoint + '/media' && response.request().method() === 'POST');
      await page.getByRole('button', {name:'Upload recording', exact:true}).click();
      expect((await initiated).status(), 'Recording upload initiation').toBe(200);
      const processing = endpoint + '/processing';
      await expect.poll(async () => (await (await context.request.get(processing)).json())?.state,
        {timeout:240000, intervals:[1000, 3000, 5000]}).toBe(seconds === 3600 ? 'ready' : 'failed');
      const state = await (await context.request.get(processing)).json();
      await page.reload();
      if (seconds === 3600) {
        await expect(page.getByText('Recording prepared', {exact:true})).toBeVisible();
        expect(state.result).toMatchObject({durationMs:3600000, sampleRate:16000, channels:1, bytes:115200044, originalTimeOffsetMs:0});
        expect(state.result.audioKey).not.toBe(state.result.sourceKey);
        const retained = join(folder, 'retained.mp4');
        execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'get', `${mediaBucket}/${state.result.sourceKey}`, ...storageFlags, '--file', retained], {stdio:'pipe', timeout:60000});
        const hash = (path:string) => createHash('sha256').update(readFileSync(path)).digest('hex');
        expect(hash(retained)).toBe(hash(source));
        const tail = await context.request.get(endpoint + '/audio', {headers:{range:'bytes=115200042-115200043'}});
        expect(tail.status()).toBe(206);
        expect(tail.headers()['content-range']).toBe('bytes 115200042-115200043/115200044');
        expect((await tail.body()).byteLength).toBe(2);
        const audio = page.getByLabel('Private interview recording');
        await expect(audio).toBeVisible();
        await expect.poll(() => audio.evaluate((element:HTMLAudioElement) => element.duration)).toBe(3600);
      } else {
        expect(state.error).toMatch(/60 minutes/);
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
