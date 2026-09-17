# Interview Coach AI

An invited pilot for software-engineering candidates reviewing recordings of hiring and mock interviews. Product requirements, architecture, glossary, and decisions are maintained in the repository documentation.

The local app supports invited accounts, private audio/video reviews, durable transcription, speaker confirmation, question grouping, cited coaching, corrections, saved preparation, and bounded recovery. Independent quality evaluation and the five-candidate pilot remain pending. The fictional interaction prototype is available at `/example`; it is separate from private reviews.

## Local development

Use Node.js 22 and the pinned pnpm version.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate:local
pnpm invite candidate@example.com
pnpm dev
```

Open `http://127.0.0.1:3000/sign-in`, choose “Have an invitation? Create account,” and use the code printed by the invitation command. Codes expire after seven days, are stored only as hashes, and are consumed after registration. Share real invitation codes privately. The CLI intentionally rejects duplicate email invitations instead of silently reactivating revoked access.

Local authentication secrets live in the ignored `.dev.vars` file. Never commit secrets, recordings, or transcripts. Authentication uses Better Auth email/password sessions with D1 persistence; public registration requires a valid invitation. Every review read/write checks the server-derived owner and active invitation. Operator revocation is an administrative update to the invitation's `revoked` flag; no public administration route exists.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Integration tests use real local D1 through Miniflare. Browser tests run the built application through Wrangler, including invitation, sign-in, create, reload, sign-out/sign-in, and deletion. Run local migrations and the Workers build before browser tests. Tests require loopback networking; no cloud credentials are required.

For development-server checks and the 60-minute recording boundary, see [local verification evidence and remaining acceptance](docs/LOCAL-VERIFICATION.md). Local functional checks do not establish deployed readiness or independent coaching quality.

## Cloudflare deployment

Preview and production use distinct Workers and D1 databases. The repository configuration contains the provisioned database IDs and exact application origins. Preview is deployed at https://interview-coach-preview.hyetigran.workers.dev; production has an isolated database and secret but the application has not been deployed there. Never bind preview to production storage.

1. Authenticate using `wrangler login` or a scoped Cloudflare API token.
2. Create the preview and production D1 databases and record each returned ID under its matching environment binding.
3. Set each environment's `APP_ORIGIN` to its exact HTTPS application origin, and set a distinct `AUTH_SECRET` with `wrangler secret put AUTH_SECRET --env <environment>`.
4. Connect Workers Builds to this repository with locked dependency installation and `pnpm lint && pnpm typecheck && pnpm test && pnpm build` as the checked build sequence. Serialize production deployments.
5. Apply reviewed migrations to the selected environment before publishing the compatible Worker: `pnpm exec wrangler d1 migrations apply DB --remote --env <environment>`.
6. Deploy with `pnpm exec opennextjs-cloudflare deploy --env <environment>` and run the create/reopen/isolation/delete smoke checks against that deployed origin.

Use backward-compatible migrations: rolling back a Worker does not undo database changes. Keep all auth secrets server-side. Remote invitations require both `--remote` and an explicit `--env preview` or `--env production`.

Successful local build/testing does not establish a deployed smoke result. Track that evidence on the originating ticket before closing it.

After preview deployment, run the same browser flow against its exact origin:

```sh
E2E_PREVIEW_ORIGIN=https://interview-coach-preview.<account-subdomain>.workers.dev pnpm test:e2e
```

This command creates two synthetic invited accounts in preview D1 using the authenticated Wrangler CLI. It verifies unauthenticated denial, owner isolation, same-origin mutation protection, create/reload/new-session persistence, and deletion. It deletes the test review; synthetic accounts remain in preview. The test refuses production origins.

### Deployment evidence (2026-09-17 UTC)

Preview Worker version `559b7f80-767b-4052-a9b9-4cddb6743b40` passed the deployed browser smoke test (23.8 seconds): invited registration, create/reload/new-session persistence, unauthenticated denial, cross-owner read/list/delete isolation, cross-origin mutation rejection, and owner deletion. Both isolated D1 databases have migration `0000_reviews.sql`; each environment has a separately generated `AUTH_SECRET` stored in Cloudflare.

Workers Builds is not yet connected. The CLI OAuth credential receives HTTP 403 from its API. Connect the preview Worker to `hyetigran/interview_coach_ai` in Settings → Builds using the persistent `staging` branch. Feature PRs merge into staging after review and CI; deployed acceptance then gates ticket closure. A separate release PR promotes accepted changes from staging to main. Use:

- Build: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm exec opennextjs-cloudflare build --env preview`
- Deploy: `pnpm exec wrangler d1 migrations apply DB --remote --env preview && pnpm exec opennextjs-cloudflare deploy --env preview`

Require a successful connected staging build before treating the selected deployment path as complete. Production app deployment remains a separate release action.

GitHub checks run on feature PRs and pushes to both `staging` and `main`. Set the preview Worker’s build branch to `staging`; do not connect its preview database to the production Worker.

`pnpm build` produces the complete OpenNext Worker bundle, including `.open-next/.build/open-next.config.edge.mjs`. `pnpm build:next` runs only the underlying Next.js compiler and is not sufficient for Cloudflare deployment. OpenNext explicitly invokes `build:next` to avoid recursively invoking itself.

## Local recording uploads

Run `pnpm setup:local`, `pnpm db:migrate:local`, and `pnpm dev`. The MEDIA binding uses local R2; no cloud credentials or paid transcription are needed. The first supported format is standard-header PCM 16-bit WAV (mono/stereo, 8–48 kHz), up to 256 MiB and 60 minutes. Uploads use 5 MiB binary parts with a 24-hour reservation and five-minute part capabilities. Reselect the original file after interruption; saved part hashes prevent mixing recordings.

`RECORDING_ALLOWANCE` defaults to three admissions per account. Reservations count while active; invalid or expired uploads release unused reservations. Deleting admitted media does not restore quota. Playback requires the signed-in owner and supports byte ranges. Review deletion immediately hides content, then removes media; a failed cleanup returns a visible pending state with retry.

The Worker scheduled handler retries cleanup every 15 minutes. To exercise it locally after `pnpm build`, run `pnpm exec wrangler dev --test-scheduled` and request `/cdn-cgi/local/scheduled` on that local server. Local `next dev` also sweeps expired uploads when loading recording status. The configured remote R2 buckets are not yet provisioned; local validation is the current delivery priority.

Run `E2E_DEV=1 pnpm test:e2e` to exercise the same upload/resume/playback/deletion flow against `next dev` itself.

## Automatic local preparation

`pnpm dev` now starts both Next.js on port 3000 and a local job Worker on port 8789. Keep this command running; closing the browser does not stop preparation. The launcher periodically triggers the local scheduled reconciler because Wrangler does not automatically fire cron events during development. Stopping the command stops both services, and D1/R2/Workflow state remains under `.wrangler/state` for the next session.

Completed uploads atomically persist a preparation job and dispatch intent. Each job uses a stable Workflow ID, one running slot per candidate, bounded retries, a five-minute deadline, and revision/lifecycle checks before publication. The local Workflow verifies actual WAV bytes and stores a SHA-256/metadata checkpoint. Polling reads progress without creating jobs. The probe is local and free; it calls no transcription or AI service. The shared processing ledger is ready for later paid stages and uses integer microdollars, with a $50 cap and unknown charges retained as reservations.

Remote rollout will require deploying `wrangler.jobs.jsonc` as well as the app, and separately provisioning its private bindings. This is deferred while local functionality is completed.

Video preparation in local development requires `ffmpeg` and `ffprobe` on PATH. `pnpm dev` starts an authenticated loopback media service on port 8790 alongside the job Worker and Next.js. Tested formats: MP4/MOV with H.264 video and one AAC audio track; WebM with VP8 or VP9 and one Opus audio track; standard PCM16 WAV. All uploads are limited to 256 MiB and actual media duration to 60 minutes. The service produces mono 16 kHz PCM WAV, keeps timestamp gaps as silence, and maps audio time to the original recording's presentation timeline with zero offset. Original videos remain private until review deletion. `pnpm test:media` runs the real FFmpeg format checks.

The local adapter makes no paid calls. Its bounded scratch files are removed after each operation, including cancellation; a new exclusive service startup removes files left by a crash. Review deletion cancels extraction and repeatedly removes both original keys and all audio attempt keys to catch late writes. A deployed media runtime and real exported interview acceptance remain deferred; synthetic codec fixtures do not establish quality on candidate recordings.

OpenAI local setup: set `OPENAI_API_KEY` in the ignored `.env` file and restart `pnpm dev`. The launcher synchronizes only that server-side key into ignored `.dev.vars` for the background Worker. The key is never passed to the browser. New uploads proceed from preparation to `gpt-4o-transcribe-diarize` with English, `diarized_json`, and automatic internal chunking. A local 32 kbps MP3 conversion keeps a 60-minute recording below the API's 25 MB limit without splitting the interview into independently labeled requests.

Initial transcripts and provider responses are private immutable R2 artifacts; segments preserve exact text and timestamps, with unconfirmed speaker labels and visible overlap. This model does not provide confidence or word-level timing. The UI pages through all segments rather than truncating the interview. Speaker confirmation/coaching are subsequent tickets.

The local transcription policy reserves $6 before a request, settles returned input/output token usage at $2.50/$10 per million, and retains reservations for unknown usage. This conservative reservation is **not a verified provider-enforced maximum**: the API exposes no documented output-token cap for internally chunked diarization. A verified worst-case bound remains a pilot blocker; the $50 ledger enforces reservations, not an unconditional upstream billing guarantee. An interrupted/ambiguous request is never automatically resubmitted. OpenAI exposes no documented transcription-result retrieval endpoint; retained request IDs and receipts support manual reconciliation, but cannot guarantee recovery of a lost result.

Provider validation on September 17: a generated 10.28-second two-voice interview returned four segments and two speaker labels through the real API. This validates connectivity, not quality on real interviews. One-hour coverage and a permissioned real recording remain acceptance work. Official references: [speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text), [model](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize), [pricing](https://developers.openai.com/api/docs/pricing), [data controls](https://developers.openai.com/api/docs/guides/your-data). The current data-controls table lists no application-state or abuse-monitoring retention for `/v1/audio/transcriptions`; billing/system metadata and the local app's retained artifacts are separate. Application deletion cannot erase platform backups outside its control.

After transcription, listen to the short speaker samples and select every detected label that represents your voice. Confirmation is tied to that immutable transcript and survives reload. Unselected speaker labels and unidentified speech are preserved. Waiting for confirmation makes no paid calls and holds no automatic processing slot. Saving creates a durable continuation intent; account concurrency may keep it visibly queued. The next question-grouping ticket will consume the confirmed attribution.

Live diarization is nondeterministic: a later run of the same two-voice synthetic fixture returned one speaker label. Browser checks verify the labels returned and persisted confirmation, while deterministic integration fixtures cover multi-label selection. This is a recorded quality limitation, not evidence of reliable speaker separation; real-corpus validation and per-passage corrections remain necessary.

Question threads (ticket #7) run after voice confirmation through the continuation
Workflow. Each bounded transcript window is grouped with
`gpt-4.1-mini-2025-04-14` using strict structured output, no background documents,
`store: false`, disabled truncation, and an 8,192-token output limit. A $0.45
reservation covers the documented full context and output ceiling at $0.40/$1.60
per million input/output tokens; actual usage settles the shared ledger. Model
limits/prices: https://developers.openai.com/api/docs/models/gpt-4.1-mini .
Unknown paid outcomes retain their reservation and never automatically resubmit.
Responses API abuse-monitoring retention is governed by the OpenAI project's data
controls; `store: false` does not mean zero retention.

Exact quotes resolve to immutable transcript IDs, UTF-16 offsets, and existing
utterance-level audio anchors. Unknown/ambiguous citations fail their section.
Successful sections remain available when another section fails. Native disclosure
controls support keyboard navigation; uncertain associations and missing answers
are visible. Candidate questions and logistics remain in the full transcript.
Grouping receipts and evidence are private and deleted with their review.

Run `pnpm test` for deterministic coverage and
`E2E_DEV=1 pnpm test:e2e e2e/threads.spec.ts` for keyboard acceptance. The opt-in
`OPENAI_GROUPING_SMOKE=1 pnpm test tests/grouping.test.ts` makes one paid OpenAI
request with synthetic text and writes its cost record to `/tmp` for importing
into the shared pilot ledger. Real-interview grouping quality and deployed
acceptance remain separate from these synthetic/local checks.

Coaching (ticket #8) processes complete question threads independently after
question grouping. A pinned GPT-4.1 mini draft is structurally validated, then a
separate bounded support-check request rejects unsupported advice before it is
published. Both calls reserve budget before the first request; prompt, rubric,
schema, verification and model versions are persisted. There is no automatic
repair loop. Unclear questions or attribution produce a clarification request
without a paid call. Successful threads remain usable if another fails.

The UI separates the original answer from a proposed future answer, rationale,
missing-fact questions and cited audio evidence. Exact citations and an automated
support check are not independent quality validation. Advice remains unevaluated
until the permissioned independent-review gate passes. Source changes mark advice
outdated; deletion removes retained advice, source snapshots and provider receipts.

`OPENAI_COACHING_SMOKE=1 pnpm test tests/coaching-integration.test.ts` runs the
opt-in paid synthetic draft/support test and writes its cost rows under `/tmp`.
The implementation uses the native Responses HTTP API with a shared bounded
adapter; no client-side credential or third-party inference proxy is involved.

Selected context (ticket #9) accepts an optional resume, job description and up to
three experience stories. Documents are limited to 12,000 characters, stories to
4,000, and the complete context to 64 KB. Each item must be explicitly selected
for future generation. Job text can explain relevance but cannot support personal
achievements; an alternative story requires selected-background citations and a
question-fit rationale. Background citations are visibly distinguished from
recorded interview speech.

Saving role/context uses optimistic concurrency and a separate coaching revision:
transcription and grouping remain valid, and no paid analysis starts from an edit.
Use **Reanalyze coaching** after saving. Reanalysis persists its intent, reuses
current work, waits for the account slot, and runs under the same shared allowance.
The first automatic analysis uses the context revision captured at speaker
confirmation; editing while grouping is underway requires explicit reanalysis.
Excluding context changes future inputs. Earlier context snapshots remain for
historical citations and saved work; whole-review deletion removes them.

### Saved preparation

Candidates can edit a proposed future answer and save up to three priorities per review. Each answer revision retains its original thread, coaching result and evidence snapshot; older preparation stays editable when analysis changes. Saved evidence is available from the preparation panel. These writes never trigger paid processing or become transcript/background facts.

Answer text is limited to 10,000 characters; each priority to 500 characters. Conditional versions reject concurrent overwrites and the editor preserves its draft until the candidate explicitly loads the latest saved version. Whole-review deletion erases all saved revisions and priorities and clears the review's private query caches.

### Transcript wording corrections

Passage corrections create immutable transcript versions and retain the original transcript, media, prior evidence and saved preparation. Candidates confirm that corrections reflect recorded speech; new career facts belong in selected background. Passage timestamps remain the original enclosing audio range, without invented word timing.

Saving revokes affected generation immediately without starting paid calls. Explicit refresh reuses the last analysis's identical grouping prefix only when candidate-speaker labels also match; a changed window invalidates its downstream carried-question dependencies. Coaching is reused only when all substantive supplied sources/metadata and generation versions match. Repeated corrections before a refresh compare against the actual earlier analysis snapshot. Earlier advice stays readable as potentially outdated history.

Correction text is bounded to 50,000 characters per passage and the complete transcript to 8 MB. Conditional versions preserve drafts on conflicts; older GET responses cannot rewind the displayed transcript. Registered object intents make interrupted correction writes discoverable for cleanup, and review deletion removes corrected snapshots.

## Independent quality evaluation

The [evaluation protocol](docs/evaluation/README.md) includes a private corpus manifest, labeling rubric, blinded baseline comparison, executable scoring, and results template. Keep recordings, reference labels, outputs, and reviewer identities outside Git. The protocol records missing recordings and independent reviewers explicitly; application tests and synthetic fixtures do not establish coaching quality.

Run the evaluation CLI checks separately from the app tests:

```sh
python3 -m unittest discover -s tests -p 'test_evaluation.py'
```
