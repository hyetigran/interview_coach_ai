// Reserve only while the persisted recording stage is eligible. A delayed POST
// must not spend after deletion, revision changes, cancellation or expiry.
export async function reserveMediaAttempt(db: D1Database, path: string) {
  const match = /^\/(operations|compression)\/((?:transcript-)?prepare-[a-f0-9-]{36})(?:-(?:prepare-)?attempt-([12]))?$/.exec(path);
  if (!match) return false;
  const [,kind,id,attemptText] = match;
  const attempt = Number(attemptText ?? 0);
  const extraction = kind === 'operations';
  if (extraction === id.startsWith('transcript-')) return false;
  const table = extraction ? 'processing_jobs' : 'transcriptions';
  const attemptColumn = extraction ? 'attempt' : 'paid_attempt';
  const stage = extraction ? "j.state='running' AND j.deadline>?" : "j.state='encoding' AND j.started_at>?";
  const eligible = `SELECT j.id FROM ${table} j JOIN reviews r ON r.id=j.review_id AND r.owner_id=j.owner_id
    WHERE j.id=? AND j.${attemptColumn}=? AND ${stage} AND r.lifecycle='active' AND r.input_revision=j.revision`;
  const args = [id,attempt,extraction ? Date.now() : Date.now()-18*60000];
  const key = 'media-' + path.slice(1).replace('/', '-');
  // A prior unresolved media attempt cannot be replaced by a new paid identity.
  const prefix = 'media-' + kind + '-' + id;
  await db.prepare(`INSERT OR IGNORE INTO processing_budget(id,operation,reserved_units)
    SELECT ?,'cloudflare-media-v1',100000 WHERE EXISTS(${eligible})
    AND NOT EXISTS(SELECT 1 FROM processing_budget WHERE state='reserved' AND id<>? AND id IN (?,?,?))
    AND COALESCE((SELECT SUM(CASE WHEN state='reserved' THEN reserved_units ELSE COALESCE(settled_units,0) END) FROM processing_budget),0)+100000<=50000000`)
    .bind(key,...args,key,prefix,prefix+(extraction?'-prepare-attempt-1':'-attempt-1'),prefix+(extraction?'-prepare-attempt-2':'-attempt-2')).run();
  return !!await db.prepare(`SELECT id FROM processing_budget WHERE id=? AND state='reserved' AND operation='cloudflare-media-v1' AND EXISTS(${eligible})`).bind(key,...args).first();
}
