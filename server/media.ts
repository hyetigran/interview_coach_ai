import { initialJobStatement, createRuntimeProcessing } from './processing';
import { validateWave } from './audio-format';
import { z } from 'zod';
import { MAX_AUDIO_BYTES, PART_BYTES, UPLOAD_LEASE_MS, type MediaState, type UploadState } from '../lib/media/contracts';
export class MediaError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = { id: string; owner_id: string; review_id: string; name: string; size: number; state: string; object_key: string; multipart_id: string | null; expires_at: number; admitted_at: number | null; lock_until: number };
type Part = { number: number; etag: string; sha256: string };
type Environment = { DB: D1Database; MEDIA: R2Bucket; AUTH_SECRET: string; RECORDING_ALLOWANCE?: string; LOCAL_MEDIA_ADAPTER?: string; PROCESSING?: Workflow<{ jobId: string }> };
const inputSchema = z.object({ name: z.string().min(1).max(200).regex(/\.(wav|mp4|mov|webm)$/i), size: z.number().int().min(46).max(MAX_AUDIO_BYTES), actionId: z.uuid() }).strict();
const activeReview = "EXISTS (SELECT 1 FROM reviews WHERE reviews.id=uploads.review_id AND reviews.owner_id=uploads.owner_id AND lifecycle='active')";
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/wav', 'X-Content-Type-Options': 'nosniff' };
async function digest(bytes: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join(''); }
export function createMediaModule(env: Environment) {
  const { DB: db, MEDIA: bucket } = env;
  const allowance = z.coerce.number().int().min(1).max(100).parse(env.RECORDING_ALLOWANCE ?? 3);
  const key = crypto.subtle.importKey('raw', new TextEncoder().encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const get = (id: string) => db.prepare('SELECT * FROM uploads WHERE id=?').bind(id).first<Row>();
  async function authorize(owner: string, review: string) {
    if (!await db.prepare("SELECT id FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active'").bind(review, owner).first()) throw new MediaError(404, 'Review not found.');
  }
  async function owned(owner: string, review: string, id: string) {
    await authorize(owner, review); const row = await get(id);
    if (!row || row.owner_id !== owner || row.review_id !== review) throw new MediaError(404, 'Upload not found.');
    return row;
  }
  async function parts(id: string) { return (await db.prepare("SELECT number,etag,sha256 FROM upload_parts WHERE upload_id=? AND etag<>'' ORDER BY number").bind(id).all<Part>()).results; }
  async function view(row: Row): Promise<UploadState> { return { id: row.id, name: row.name, size: row.size, state: row.state, expiresAt: row.expires_at, parts: (await parts(row.id)).map(p => ({ number: p.number, sha256: p.sha256 })) }; }
  async function cleanupAudio(id: string) {
    let cursor: string | undefined;
    do { const page = await bucket.list({ prefix: 'audio/' + id + '/', cursor }); if (page.objects.length) await bucket.delete(page.objects.map(object => object.key)); cursor = page.truncated ? page.cursor : undefined; } while (cursor);
  }
  async function cleanupRow(row: Row) {
    // Keep tombstones and object keys: a late completion can write after an earlier cleanup.
    await Promise.all([row.multipart_id ? bucket.resumeMultipartUpload(row.object_key, row.multipart_id).abort() : Promise.resolve(), bucket.delete(row.object_key), cleanupAudio(row.id), bucket.delete([`transcripts/${row.review_id}/transcript-prepare-${row.id}.json`, `transcripts/${row.review_id}/transcript-prepare-${row.id}.provider.json`])]);
    await db.prepare('DELETE FROM upload_parts WHERE upload_id=?').bind(row.id).run();
    await db.prepare("UPDATE uploads SET cleaned_at=?, name='' WHERE id=? AND state='cleanup'").bind(Date.now(), row.id).run();
  }
  async function cleanup() {
    await db.prepare("UPDATE uploads SET state='cleanup' WHERE admitted_at IS NULL AND state NOT IN ('cleanup','rejected') AND expires_at<=?").bind(Date.now()).run();
    const rows = (await db.prepare("SELECT * FROM uploads WHERE state='cleanup' ORDER BY COALESCE(cleanup_attempted_at,0), created_at LIMIT 25").all<Row>()).results;
    for (const row of rows) { await db.prepare('UPDATE uploads SET cleanup_attempted_at=? WHERE id=?').bind(Date.now(), row.id).run(); try { await cleanupRow(row); } catch { /* Persisted tombstone is retried by the next sweep. */ } }
  }
  async function status(owner: string, review: string): Promise<MediaState> {
    await authorize(owner, review); await cleanup();
    const row = await db.prepare('SELECT * FROM uploads WHERE review_id=? AND owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(review, owner).first<Row>();
    const usage = await db.prepare("SELECT SUM(CASE WHEN admitted_at IS NOT NULL THEN 1 ELSE 0 END) AS admitted, SUM(CASE WHEN admitted_at IS NULL AND state NOT IN ('cleanup','rejected') AND expires_at>? THEN 1 ELSE 0 END) AS reserved FROM uploads WHERE owner_id=?").bind(Date.now(), owner).first<{ admitted: number; reserved: number }>();
    return { upload: row ? await view(row) : null, admitted: usage?.admitted ?? 0, reserved: usage?.reserved ?? 0, allowance };
  }
  async function initiate(owner: string, review: string, input: unknown) {
    const valid = inputSchema.parse(input); await authorize(owner, review); await cleanup();
    const now = Date.now(), id = crypto.randomUUID();
    await db.prepare(`INSERT INTO uploads (id,owner_id,review_id,action_id,name,size,state,object_key,expires_at,created_at) SELECT ?,?,?,?,?,?,'initializing',?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='active') AND NOT EXISTS(SELECT 1 FROM uploads WHERE review_id=? AND state<>'cleanup') AND (SELECT COUNT(*) FROM uploads WHERE owner_id=? AND (admitted_at IS NOT NULL OR (state<>'cleanup' AND expires_at>?)))<?`).bind(id, owner, review, valid.actionId, valid.name, valid.size, 'originals/' + id, now + UPLOAD_LEASE_MS, now, review, owner, review, owner, now, allowance).run();
    let row = await db.prepare("SELECT * FROM uploads WHERE review_id=? AND owner_id=? AND state<>'cleanup' ORDER BY created_at DESC LIMIT 1").bind(review, owner).first<Row>();
    if (!row) throw new MediaError(409, 'Recording allowance reached or review no longer available.');
    if (row.id !== id) return view(row);
    try {
      const multipart = await bucket.createMultipartUpload(row.object_key, { httpMetadata: { contentType: /\.wav$/i.test(row.name) ? 'audio/wav' : 'application/octet-stream' } });
      // Register even if deleted during creation, so the multipart ID can be reclaimed.
      await db.prepare('UPDATE uploads SET multipart_id=?, cleaned_at=NULL WHERE id=?').bind(multipart.uploadId, id).run();
      const updated = await db.prepare(`UPDATE uploads SET state='uploading' WHERE id=? AND state='initializing' AND expires_at>? AND ${activeReview}`).bind(id, Date.now()).run();
      if (!updated.meta.changes) { await multipart.abort(); throw new MediaError(410, 'Upload is no longer active.'); }
      row = (await get(id))!; return view(row);
    } catch (error) {
      await db.prepare("UPDATE uploads SET state='cleanup' WHERE id=? AND admitted_at IS NULL").bind(id).run(); await cleanup(); throw error;
    }
  }
  async function signPart(owner: string, review: string, id: string, number: number) {
    const row = await owned(owner, review, id);
    if (row.state !== 'uploading' || row.expires_at <= Date.now() || !Number.isInteger(number) || number < 1 || number > Math.ceil(row.size / PART_BYTES)) throw new MediaError(410, 'Upload expired or part is invalid. Start again.');
    const expires = Math.min(row.expires_at, Date.now() + 5 * 60000);
    const payload = `${owner}:${review}:${id}:${number}:${expires}`;
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(payload)));
    return { token: `${expires}.${Array.from(signature, b => b.toString(16).padStart(2, '0')).join('')}` };
  }
  async function putPart(owner: string, review: string, id: string, number: number, token: string, bytes: Uint8Array) {
    const row = await owned(owner, review, id); const match = /^(\d+)\.([0-9a-f]{64})$/.exec(token);
    if (!match || Number(match[1]) <= Date.now() || !await crypto.subtle.verify('HMAC', await key, Uint8Array.from(match[2].match(/../g)!, h => parseInt(h, 16)), new TextEncoder().encode(`${owner}:${review}:${id}:${number}:${match[1]}`))) throw new MediaError(403, 'Part permission expired. Resume the upload.');
    if (row.state !== 'uploading' || row.expires_at <= Date.now() || !row.multipart_id || number < 1 || number > Math.ceil(row.size / PART_BYTES) || !Number.isInteger(number)) throw new MediaError(410, 'Upload no longer active.');
    const expected = Math.min(PART_BYTES, row.size - (number - 1) * PART_BYTES);
    if (bytes.byteLength !== expected) throw new MediaError(422, 'Part size does not match the selected file.');
    const hash = await digest(bytes), partId = `${id}:${number}`;
    await db.prepare(`INSERT OR IGNORE INTO upload_parts (id,upload_id,number,etag,sha256) SELECT ?,?,?,'',? WHERE EXISTS(SELECT 1 FROM uploads WHERE id=? AND state='uploading' AND expires_at>? AND ${activeReview})`).bind(partId, id, number, hash, id, Date.now()).run();
    const saved = await db.prepare('SELECT etag,sha256 FROM upload_parts WHERE id=?').bind(partId).first<Part>();
    if (!saved) throw new MediaError(410, 'Upload no longer active.');
    if (saved.sha256 !== hash) throw new MediaError(409, 'This is a different file. Select the original file to resume.');
    if (saved.etag) return;
    const result = await bucket.resumeMultipartUpload(row.object_key, row.multipart_id).uploadPart(number, bytes);
    const updated = await db.prepare(`UPDATE upload_parts SET etag=? WHERE id=? AND EXISTS(SELECT 1 FROM uploads WHERE id=? AND state='uploading' AND expires_at>? AND ${activeReview})`).bind(result.etag, partId, id, Date.now()).run();
    if (!updated.meta.changes) { await cleanup(); throw new MediaError(410, 'Upload no longer active.'); }
  }
  async function complete(owner: string, review: string, id: string) {
    let row = await owned(owner, review, id);
    if (['admitted', 'validating', 'rejected'].includes(row.state)) return view(row);
    if (row.expires_at <= Date.now() || !['uploading', 'completing'].includes(row.state) || !row.multipart_id) throw new MediaError(410, 'Upload expired. Start again.');
    const uploaded = await parts(id);
    if (uploaded.length !== Math.ceil(row.size / PART_BYTES)) throw new MediaError(409, 'Upload all parts before completing.');
    const claimToken = crypto.randomUUID();
    const claimed = await db.prepare(`UPDATE uploads SET state='completing',claim_token=?,lock_until=? WHERE id=? AND expires_at>? AND (state='uploading' OR (state='completing' AND lock_until<?)) AND ${activeReview}`).bind(claimToken, Date.now() + 60000, id, Date.now(), Date.now()).run();
    if (!claimed.meta.changes) return view((await owned(owner, review, id)));
    try {
      let object = await bucket.head(row.object_key);
      if (!object) object = await bucket.resumeMultipartUpload(row.object_key, row.multipart_id).complete(uploaded.map(p => ({ partNumber: p.number, etag: p.etag })));
      if (object.size !== row.size || object.size > MAX_AUDIO_BYTES || object.httpMetadata?.contentType !== (/\.wav$/i.test(row.name) ? 'audio/wav' : 'application/octet-stream')) throw new MediaError(422, 'Stored recording metadata does not match the upload.');
      if (/\.wav$/i.test(row.name)) { const header = await bucket.get(row.object_key, { range: { offset: 0, length: 44 } });
      if (!header) throw new Error('Recording unavailable'); try { validateWave(await header.arrayBuffer(), object.size); } catch (error) { throw new MediaError(422, error instanceof Error ? error.message : 'Invalid audio.'); } }
      const publication = db.prepare(`UPDATE uploads SET state=?,admitted_at=?,lock_until=0 WHERE id=? AND claim_token=? AND state='completing' AND expires_at>? AND ${activeReview}`).bind(/\.wav$/i.test(row.name) ? 'admitted' : 'validating', /\.wav$/i.test(row.name) ? Date.now() : null, id, claimToken, Date.now());
      const [published] = await db.batch([publication, initialJobStatement(db, id)]);
      if (!published.meta.changes) {
        const latest = await get(id);
        if (latest && (['admitted', 'validating', 'rejected'].includes(latest.state) || (latest.state === 'completing' && latest.expires_at > Date.now()))) {
          await authorize(owner, review); return view(latest);
        }
        await bucket.delete(row.object_key); throw new MediaError(410, 'Review or upload is no longer active.');
      }
      await createRuntimeProcessing(env).reconcile();
      row = (await get(id))!; return view(row);
    } catch (error) {
      if (error instanceof MediaError) await db.prepare("UPDATE uploads SET state='cleanup' WHERE id=? AND claim_token=? AND admitted_at IS NULL").bind(id, claimToken).run();
      else await db.prepare("UPDATE uploads SET lock_until=0 WHERE id=? AND claim_token=? AND state='completing'").bind(id, claimToken).run();
      await cleanup(); throw error;
    }
  }
  async function remove(owner: string, review: string) {
    await db.batch([
      db.prepare("UPDATE reviews SET lifecycle='deleting',title='',role='' WHERE id=? AND owner_id=?").bind(review, owner),
      db.prepare("UPDATE uploads SET state='cleanup',name='',cleaned_at=NULL WHERE review_id=? AND owner_id=? AND EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='deleting')").bind(review, owner, review, owner),
      db.prepare("UPDATE processing_jobs SET dispatch_state=CASE WHEN state='queued' OR (state='cancelled' AND dispatch_state='cancelled') THEN 'cancelled' ELSE 'cancel_pending' END,state='cancelled',result=NULL,error=NULL,finished_at=? WHERE review_id=? AND owner_id=? AND EXISTS(SELECT 1 FROM reviews WHERE id=? AND owner_id=? AND lifecycle='deleting')").bind(Date.now(), review, owner, review, owner),
    ]);
    await db.prepare("UPDATE speaker_confirmations SET state='cancelled',speakers='[]' WHERE review_id=? AND owner_id=?").bind(review,owner).run();
    await db.prepare("UPDATE transcriptions SET state='cancelled',result_key=NULL,error=NULL WHERE review_id=? AND owner_id=?").bind(review, owner).run();
    const rows = (await db.prepare("SELECT * FROM uploads WHERE review_id=? AND owner_id=? AND state='cleanup'").bind(review, owner).all<Row>()).results;
    for (const row of rows) { try { await cleanupRow(row); } catch { /* Report pending and retain for retry. */ } }
    await createRuntimeProcessing(env).reconcile();
    return deletionStatus(owner, review);
  }
  async function deletionStatus(owner: string, review: string) {
    const deleted = await db.prepare("SELECT id FROM reviews WHERE id=? AND owner_id=? AND lifecycle='deleting'").bind(review, owner).first();
    if (!deleted) return { cleanupPending: false };
    const pending = await db.prepare("SELECT id FROM uploads WHERE review_id=? AND owner_id=? AND state='cleanup' AND cleaned_at IS NULL LIMIT 1").bind(review, owner).first();
    const pendingJob = await db.prepare("SELECT id FROM processing_jobs WHERE review_id=? AND owner_id=? AND dispatch_state='cancel_pending' LIMIT 1").bind(review, owner).first();
    return { cleanupPending: Boolean(pending || pendingJob) };
  }
  async function play(owner: string, review: string, range: string | null, head = false) {
    await authorize(owner, review);
    const row = await db.prepare("SELECT * FROM uploads WHERE review_id=? AND owner_id=? AND state='admitted'").bind(review, owner).first<Row>();
    if (!row) throw new MediaError(404, 'Recording not found.');
    if (!/\.wav$/i.test(row.name)) {
      const job = await db.prepare("SELECT result FROM processing_jobs WHERE review_id=? AND owner_id=? AND state='ready' AND revision=(SELECT input_revision FROM reviews WHERE id=?)").bind(review, owner, review).first<{ result: string }>();
      if (!job) throw new MediaError(409, 'Audio is still being prepared.');
      const result = JSON.parse(job.result); row.object_key = result.audioKey; row.size = result.audioBytes;
    }
    let start = 0, end = row.size - 1;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { ...privateHeaders, 'Content-Range': `bytes */${row.size}` } });
      start = m[1] ? Number(m[1]) : Math.max(0, row.size - Number(m[2]));
      end = m[1] && m[2] ? Math.min(Number(m[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= row.size) return new Response(null, { status: 416, headers: { ...privateHeaders, 'Content-Range': `bytes */${row.size}` } });
    }
    const headers = { ...privateHeaders, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${row.size}` } : {}) };
    if (head) return new Response(null, { status: range ? 206 : 200, headers });
    const object = await bucket.get(row.object_key, { range: { offset: start, length: end - start + 1 } });
    if (!object) throw new MediaError(404, 'Recording not found.');
    await authorize(owner, review);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }
  return { initiate, status, signPart, putPart, complete, remove, play, cleanup, deletionStatus };
}
