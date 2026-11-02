# Deliverables checklist

Status as of **1 Oct 2026** (YouTube staging rollout and real hosted attempt). Product intent is defined in [PRD.md](PRD.md). This checklist describes the implementation merged into [staging](https://github.com/hyetigran/interview_coach_ai/tree/staging), not just the older prototype in this root checkout. The implementation worktree is `/private/tmp/interviewcoach-ticket-audit`.

**Tickets: 11 closed · 5 open (#4, #5, #14, #15, #16).** Implemented functionality and passing tests do not establish complete pilot acceptance or independent coaching quality. The YouTube rollout was authorized and deployed. Investigation found a shutdown defect (fixed on staging) and intermittent upstream HTTP 403 refusals (unresolved). A follow-up comparison with Debate Coach’s embedded YouTube client passed two consecutive hosted imports (10 seconds and the full 38:38); PR #52 merged this compatibility improvement into staging after all CI checks passed. The full recording is transcribing. Intermittent upstream availability, independent quality and pilot evidence remain outstanding.

| Status | Meaning |
| --- | --- |
| Implemented | Present in tracked staging source; broader acceptance may remain |
| Verified | Passed the specific checks described here; no broader claim implied |
| Partial | Some implementation or evidence exists, but the stated deliverable is incomplete |
| Pending | Required evidence, participants, or execution is unavailable |
| Deferred | Explicitly outside the pilot scope, or explicitly deferred by the user |

## Planning, documentation, and application foundation

- [x] Product requirements, domain language, architecture, and recording-first/durable-processing ADRs — **Implemented**
- [x] README, app name, package scripts, lint, and typechecking aligned — **Implemented**
- [x] Next.js app on Cloudflare Workers using OpenNext, D1/Drizzle, R2, Workflows, and a private media processor — **Implemented**
- [x] Recording-first intake and persisted review workspace replace the hardcoded prototype flow — **Implemented**
- [x] Invited authentication and owner-scoped review access — **Implemented**; ticket #1 closed
- [x] Earlier `mockups/`, Memory Bank, and `.cursor/rules` retained as planning/history artifacts — **Available locally**; not runtime acceptance evidence
- [ ] Preview/production isolation and complete operational acceptance — **Partial**; preview checks exist, while the full #15 acceptance remains open

## 1. Feasibility, formats, and costs

- [x] Media preparation, transcription, and coaching integrations selected and connected — **Implemented**; representative-recording and quality validation remain below
- [x] Standard-header PCM 16-bit WAV and supported MP4/MOV/WebM intake; 256 MiB input and 60-minute duration limits — **Implemented**
- [x] Synthetic preview video at 3600 seconds produced playable audio; 3601 seconds was rejected — **Verified** for the documented runs
- [ ] Representative exported interview files and complete deployed format/error/deletion matrix — **Partial**; user-supplied YouTube mock video passed local preparation on 27 Sep, but native exports and deployed acceptance remain; #4 stays open
- [ ] Verified upstream maximum processing charge and actual recording-level costs — **Partial**; internal reservations are not a provider-enforced billing guarantee
- [ ] Provider/project retention settings, Workflow/backup retention, and external erasure behavior — **Pending verification**

## 2. Intake, storage, and deletion

- [x] Create and reopen reviews with title, target role, and hiring/mock origin — **Implemented**
- [x] Private multipart R2 uploads with signed parts and interruption recovery — **Implemented**
- [x] Three-recording admission reservations with retry identity reuse — **Implemented**
- [x] D1 schema, Drizzle migrations, and shared $50 reservation/settlement ledger — **Implemented**
- [x] Owner-scoped ranged audio playback — **Implemented**
- [x] Immediate access revocation with retryable physical cleanup — **Implemented**
- [x] Concurrent preview upload reservations, cross-owner denial, deletion, freed-slot reuse, and cleanup — **Verified**; reservation-only test passed in 42.3 seconds
- [x] Deleted upload capabilities rejected; scheduled cleanup removed four injected late artifacts — **Verified** on 21 Sep, 53.3 seconds
- [ ] Completed-upload races and deletion during every active processing stage on deployed resources — **Partial**; synthetic late writes do not establish live provider cancellation behavior

## 3. Durable transcription and speakers

- [x] Media probing, playback-audio extraction, and durable Workflow dispatch — **Implemented**; ticket #3 closed
- [x] Persisted timestamped transcript, speaker labels, overlap/uncertainty indicators, and source playback — **Implemented**
- [x] Bounded multipart transcription, original timeline offsets, per-part speaker confirmation, and completed-part reuse — **Implemented**
- [x] Persisted progress and actionable waiting/failure states — **Implemented**
- [x] Candidate speaker confirmation from recorded samples — **Implemented**; ticket #6 closed
- [x] One active automatic pipeline per account, stable paid identities, and receipt reconciliation — **Implemented**; local race/recovery tests exist
- [x] Preparation and saved-transcript publication recovery after server acceptance and browser closure — **Verified** in preview on 21 Sep; duplicate actions retained identities and the zero-cost fixture ledger
- [ ] Real recording validates the complete transcription integration — **Pending execution**; user-supplied interview audio and two parts are prepared locally, but no app-provider run on this sample is established; #5 stays open
- [ ] Full 60-minute audio and video journey through saved preparation — **Partial**; prior hour probes are not a complete passing journey

## 4. Grouping, coaching, and evidence

- [x] Chronological question/answer navigation with nested follow-ups — **Implemented**; ticket #7 closed
- [x] Original answer, proposed future wording, explanations, and timestamped citations — **Implemented**; ticket #8 closed
- [x] Grounding/support checks and visible uncertainty or missing-fact requests — **Implemented**; absence of critical defects is not independently proven
- [x] Selected background and job context, with supported alternative-story suggestions — **Implemented**; ticket #9 closed
- [ ] Independent grouping accuracy, useful-action coverage, and coaching quality — **Pending**; synthetic fixtures and author checks are not independent evidence

## 5. Corrections, saved work, and recovery

- [x] Transcript wording, speaker attribution, and question-association corrections — **Implemented**; tickets #11 and #12 closed
- [x] Dependent advice marked outdated; explicit reanalysis with stage reuse — **Implemented**
- [x] Persisted editable future answers and up to three preparation priorities across visits — **Implemented**; ticket #10 closed
- [x] Interrupted-stage recovery, finite retries, and retained unknown-charge reservations — **Implemented**; ticket #13 closed
- [x] Local tests for account/budget races, permission isolation, deletion, and late publication — **Verified** within their deterministic boundaries
- [ ] Remaining deployed account-job and final-budget reservation races — **Pending**; isolated budget probe passes locally, but remote execution needs provisioning approval

## 6. Pilot acceptance (IC-01–IC-12)

Checkboxes below mean acceptance of the full criterion, not merely implementation of its UI or API.

- [ ] IC-01 Recording intake — **Partial**; implemented with synthetic duration/format evidence, representative recording acceptance outstanding
- [ ] IC-02 Transcript and grouping (≥90% on frozen labeled corpus) — **Pending independent evaluation**
- [ ] IC-03 Grounded recommendations (resolving citations + human support check) — **Partial**; citations/support logic implemented, independent human assessment outstanding
- [ ] IC-04 Useful future answer (speech vs revision vs missing-fact request) — **Partial**; product behavior implemented, usefulness evidence outstanding
- [ ] IC-05 Useful action coverage (≥70% of substantive threads) — **Pending independent evaluation**
- [ ] IC-06 Review usability without full-transcript approval — **Partial**; implemented, unassisted candidate observations outstanding
- [ ] IC-07 Safe correction and non-overwriting reanalysis — **Partial**; implemented and locally tested, complete deployed acceptance outstanding
- [ ] IC-08 No critical invented personal facts — **Pending independent evaluation**; automated checks do not prove this criterion
- [ ] IC-09 Saved preparation persists; no recurring-theme claim — **Partial**; persistence implemented/tested, complete pilot journey outstanding
- [ ] IC-10 Durable recovery and deletion — **Partial**; deployed recovery/late-artifact checks pass, all live-stage deletion and external retention evidence outstanding
- [ ] IC-11 Accessible partial, error, and outdated states — **Partial**; keyboard/state checks exist, comprehensive deployed accessibility acceptance outstanding
- [ ] IC-12 Cross-owner isolation, concurrent limits, shared budget — **Partial**; local invariants and deployed reservation isolation pass, remaining deployed races/cost bounds outstanding
- [x] Evaluation manifest template, labeling rubric, frozen-input tooling, blinded baseline protocol, scoring, and report template — **Implemented**
- [ ] Permissioned frozen corpus, independent labels/reviewers, actual blinded comparison, and quality report — **Pending**; #14 remains open
- [x] Five-candidate pilot protocol and anonymized report template — **Implemented**
- [ ] Recruit and observe all five candidates; report whether four independently finish and save a useful suggestion — **Pending**; #16 remains open and depends on #15
- [ ] Actual pilot report, known/unknown costs, failures, correction effort, eligible return, and next decision — **Pending**; no participant outcomes have been collected

## Latest verification and merged work

- [PR #51](https://github.com/hyetigran/interview_coach_ai/pull/51), merged as `4c6fbbf8949c7541d52b22eeeac21dbcc4e32a84`: graceful media shutdown and safe failure diagnostics. All 224 app tests, 14 media tests, and CI (including browser tests) passed. A real-process SIGTERM regression failed before the fix and passed afterward. The supplied 38:38 interview imported successfully during diagnosis; a separate post-fix short import received YouTube HTTP 403. Paste-link reliability is still not accepted as complete.

- [PR #50](https://github.com/hyetigran/interview_coach_ai/pull/50): paste-link YouTube intake merged and deployed to staging with migration 0033, media service, jobs, and app. Real supplied-link import failed before transcription; no coaching or saved answer was produced. See [1 Oct hosted evidence](verification/youtube-staging-20261001.md).

- [PR #46](https://github.com/hyetigran/interview_coach_ai/pull/46): corrected duplicate evaluation judgments; four evaluation tests passed.
- [PR #47](https://github.com/hyetigran/interview_coach_ai/pull/47): concurrent admission test and review-scoped receipt cleanup. Both independent review axes had zero findings; CI passed. Local app suite: 216 passed, three provider tests skipped. Local browser suite: 13 passed, 12 opt-in cases skipped.
- [PR #48](https://github.com/hyetigran/interview_coach_ai/pull/48): recording pipeline, retry-cost, retention, and deployed-evidence documentation corrected; both review axes and all CI checks passed. Merged into staging as `9178c72226fb45dc8e1fc18dd34f86c0d1302d77`.
- On 21 Sep, three deployed preparation/publication recovery and late-artifact cleanup tests passed in 3.2 minutes against preview app version `f3e00276-711f-4d4d-a714-129afe464842`. They used synthetic artifacts and fixture receipts, not real interview/provider-outage evidence.
- Local browser logs included cancellation/aborted-response diagnostics during other journeys. Passing assertions do not establish those diagnostics are resolved.

See staging's [admission evidence](https://github.com/hyetigran/interview_coach_ai/blob/staging/docs/verification/admission-race.md), [recovery scope](https://github.com/hyetigran/interview_coach_ai/blob/staging/docs/verification/recovery-preview.md), [media boundary evidence](https://github.com/hyetigran/interview_coach_ai/blob/staging/docs/verification/media-boundary-preview.md), and [evaluation protocol](https://github.com/hyetigran/interview_coach_ai/blob/staging/docs/evaluation/README.md).

## Outstanding inputs and authorization

1. **Sample supplied; independent evaluation still outstanding.** On 27 Sep the user supplied a real behavioral mock interview. The interview-only video and captions are available privately; local application audio extraction and two-part compression passed. See [sample evidence](verification/mock-interview-sample.md). This supersedes the blanket sample deferral from 20 Sep. Deployed provider validation, a frozen independent corpus, labels/reviewers, and blinded evaluation are still outstanding.
2. **Billing evidence.** Preview ledger read on 21 Sep showed $0.364869 in settled OpenAI charges, $3.10 in unresolved media reservations, and a separate unresolved $6 diagnostic reservation. These are ledger observations, not a reconciled provider invoice or total hosting/storage cost. Reservations have not been cleared without evidence.
3. **Actual retention settings.** Confirm the OpenAI project's effective data controls and Cloudflare Workflow/backup retention. Published provider policy alone does not verify account configuration.
4. **Isolated remote budget probe approval.** The prepared eight-way budget race passed locally using the application ledger module. Automatic approval review rejected creating temporary D1 database `interview-coach-budget-probe-20260921` because branch authorization does not cover provisioning with potential billing. No database was created; approval to create it, run the synthetic probe, and delete it afterward remains pending.
5. **Pilot participants and outcomes.** Five candidates have not been recruited or observed; launching the pilot depends on completing the required functional and quality gates.

Push, PR creation, and merge into **staging** remain authorized for remaining ticket branches after checks pass. Production promotion is a separate release action. No ticket should be closed solely because its implementation or synthetic tests pass.

## Deferred (not pilot deliverables)

- [ ] Meet/Zoom account connections
- [ ] Meeting bots
- [ ] Live assistance
- [ ] Generated practice interviews
- [ ] Coached retries
- [ ] Synchronized video playback
- [ ] Visual or vocal delivery assessment
- [ ] Technical-correctness verdicts
- [ ] Automatic recurring themes
- [ ] PDF parsing
- [ ] Social-account connections
- [ ] Crawling
- [ ] Code execution
- [ ] Customer billing/payments (processing cost accounting remains in scope)
- [ ] Public sharing
- [ ] Coach teams

- [PR #52](https://github.com/hyetigran/interview_coach_ai/pull/52), merged as `fd2a0d60617605a1a9ba024e568c9edf37f7dc12`: adopted Debate Coach’s `web_embedded` YouTube client. Two consecutive hosted imports passed (10 seconds and full 38:38, matching the prior audio checksum). Media version `843d2cb7-22bf-4230-9a5b-f4c6ea6e6f35` is deployed to staging. All CI checks, 14 local media tests and 30 focused tests passed. General YouTube reliability and downstream full coaching acceptance remain unproven.
