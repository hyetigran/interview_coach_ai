# Local pilot verification — 2026-09-17

Ticket #15 remains open. This evidence covers local development, not the required complete workflow on isolated deployed resources. It does not establish independent coaching quality or five-candidate usability.

## Reproduce

Use a separate checkout with ignored local configuration and synthetic recordings. Run `pnpm setup:local` and `pnpm db:migrate:local` before starting tests. Stop any other app using ports 3000, 8789, and 8790.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:media
E2E_DEV=1 pnpm test:e2e
python3 -m unittest discover -s tests -p 'test_evaluation.py'
```

For the deterministic browser recovery cases, `.env` can contain a deliberately invalid `OPENAI_API_KEY=local-test-placeholder-not-a-provider-credential`. This exercises configured recovery controls without a valid paid credential. Do not set the opt-in provider smoke variables or `OPENAI_TEST_WAV` for this run. A passing mocked provider flow does not validate the live provider. Real local use requires a valid key in the ignored `.env`; `pnpm dev` synchronizes it to the ignored Worker configuration without printing it.

## Evidence and limits

| Area | Local evidence | Still required |
| --- | --- | --- |
| 60-minute audio | Real multipart upload into local R2, admission, final-sample ranged playback; 60 minutes plus one second rejected | Full-length live transcription through saved preparation, deployed |
| 60-minute video | Generated H.264/AAC MP4 decoded into exactly 115,200,000 PCM bytes plus WAV header; 60 minutes plus one second rejected | Full-length video intake through saved preparation, deployed |
| Other video formats | Short real MOV H.264/AAC, WebM VP8/Opus and VP9/Opus extraction | Representative candidate files, full-length variants, deployed runtime |
| Review interaction | Browser cases cover invitations, persistence, context conflicts, corrections, speaker/grouping changes, saved preparation, recovery and keyboard thread navigation | Manual accessibility review and all ticket #15 states on deployed resources |
| Earlier advice | Browser fixture matches the API retaining outdated saved results; advice remains visible and an unsaved future-answer draft survives refresh | Real source correction through regeneration and saved history on deployed resources |
| Isolation, concurrency, deletion | Deterministic local D1/R2 integration cases exercise owner checks, budget/account claims, unknown billing, interrupted work and cleanup | Deployed races, deletion at every running stage, late artifacts and environment isolation |
| Quality | Evaluation CLI regression checks; protocol and blank report template | Permissioned frozen corpus, independent reviewers, blinded baseline and actual scores |

The initial full browser run passed eight cases, skipped the opt-in transcription case and failed the stale earlier-advice fixture/assertion. The fixture previously returned no historical jobs, unlike the API. Local workerd also emitted intermittent hung-request and D1 internal-error diagnostics during that run; passing assertions do not prove these diagnostics are resolved. Record them when assessing longer live sessions.

A second full run passed seven cases, skipped transcription, and exposed two failures: a transient server error before the correction editor loaded, and a saved-preparation recovery race. The latter allowed “Load latest” to replace a draft with cached text while a refresh was still pending. Answer and priority recovery now await a successful server refresh, disable editing during that operation, and preserve drafts if it fails. Browser regression cases force the refresh failure and then verify recovery after service resumes.

After the recovery fix, the final full development-server browser run passed all nine enabled cases in 2.8 minutes; the paid transcription case was skipped. App tests passed 146 cases with three opt-in provider skips, media tests passed nine cases, and the evaluation CLI passed three tests. Lint and type checking passed. Both standards and spec reviews found no material defects in this local increment. Earlier intermittent runtime errors remain an observation to investigate during longer sessions, rather than a claim of resolved runtime reliability.

## Tested configuration

### Local database ownership

An isolated diagnostic reproduced the intermittent local database errors: 27 of 100 simultaneous writes failed with `SQLITE_BUSY` or `SQLITE_BUSY_SNAPSHOT` when two Miniflare runtimes opened the same persisted database. The one-runtime control completed all 100 writes. Reproduce against disposable storage with `node scripts/d1-concurrency-probe.mjs 2` and `node scripts/d1-concurrency-probe.mjs 1`; the two-runtime command intentionally exits nonzero when it reproduces the lock. Failure counts depend on scheduling.

Local API requests now pass through the job Worker, so normal API and Workflow operations use one database-owning runtime. The hop requires the local authentication secret and exact loopback configuration; it preserves cookies, request origins and bodies, and does not follow redirects. Preview/production omit the local binding and keep their existing request path. Local CLI seed/migration operations can still open another runtime, so run migrations before starting development and do not treat this change as proof that simultaneous CLI access is safe.

The proxy requests identity encoding internally because Node fetch decodes compressed response bodies while retaining their encoding header. The outer Next server owns browser response encoding. Focused signup and keyboard navigation passed through this path; full regression results for this change must be recorded separately from the earlier run above.

The first complete run through the corrected proxy passed seven browser cases; two synthetic signups hit HTTP 429 because the faster suite shares one loopback IP. Browser setup now honors the auth server's `X-Retry-After` once, capped at ten seconds, only after an explicit 429 rejection. It does not disable rate limiting or retry database/server failures.

Final verification of the local ownership change passed 149 app regression tests (three opt-in provider skips), lint, type checking, binding generation and the OpenNext build. Both full browser modes passed all nine enabled tests in 1.6 minutes each: `E2E_DEV=1 pnpm test:e2e` and the compiled-Worker `pnpm test:e2e`. Each skipped the paid transcription test; neither log contained `SQLITE_BUSY`. Both independent review axes found no material defects. These observations cover the tested local runs, not arbitrary concurrent CLI writes or deployed readiness.

The installed environment uses Node 22.19.0, Next 16.3.4, OpenNext Cloudflare 1.20.6, Wrangler 4.130.0, Miniflare 5.20260908.0-alpha and FFmpeg 8.1.2. See the lockfile for transitive versions. Source configuration selects `gpt-4o-transcribe-diarize` for transcription and `gpt-4.1-mini-2025-04-14` for grouping/coaching; no provider invocation is established by the deterministic checks above.

The app accepts standard-header PCM 16-bit WAV (one/two channels, 8–48 kHz) and supported MP4/MOV/WebM video, with a 256 MiB input ceiling and 60-minute duration ceiling. Both limits apply: some uncompressed 60-minute WAV files exceed the byte ceiling. Parts are 5 MiB, upload reservations last 24 hours, and part capabilities last five minutes. Admission defaults to three recordings per account, one active automatic job per account, and a shared $50 processing ledger. These are configured bounds, not measured cost for fifteen hour-long recordings; hosting/storage is separate.

Whole-review deletion denies application access immediately and reconciles retained media, snapshots and provider receipts. Pending physical cleanup is distinct from immediate access denial. Provider/platform retention, backups and deployed cleanup timing still require verification; local deletion tests cannot establish erasure outside application storage. See [recovery behavior](RECOVERY.md) and the [evaluation protocol](evaluation/README.md).

## Remaining acceptance

Keep #14, #15 and #16 open until their external evidence exists. Before enabling a candidate pilot, run the complete deployed audio/video flow, measure latency and actual known/unknown costs, verify retention and all deletion stages, and complete independent quality evaluation. Then observe all five candidates without replacing unsuccessful participants or counting facilitator-assisted completion as independent success. Publish only anonymized findings; recordings, labels, reviewer identities and candidate content stay outside Git.
