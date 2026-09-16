# Interview Coach AI — Product requirements

Version: 0.5 · September 16, 2026 · Status: recording-based invited pilot confirmed; implementation pending

## 1. Product promise and first audience

Help software-engineering candidates prepare more relevant, specific, and truthful future answers by reviewing recordings of their past hiring or mock interviews. The initial coaching scope is behavioral questions and discussion of past projects: question coverage, clarity, supported detail, personal contribution, organization, and explained tradeoffs.

A review provides a supported proposed answer, a brief explanation linked to the interview evidence, and an alternative personal story only when supplied background supports it. Preserve a strong answer when rewriting would not help. Diagnosis supports preparation; this is not an interview scorecard.

The first delivery is an authenticated, invite-only pilot for five candidates. Recruit initially through externally conducted mock interviews, while supporting hiring interviews through the same workflow. Google Meet and Zoom are sources of user-provided recordings, not integrations. A hiring interview assesses someone for an actual job opening; a mock interview is practice. This distinction records origin and does not change the coaching pipeline.

Do not claim to recover a private interviewer rubric, explain a rejection, predict an offer, or prove better interview performance from a saved rewrite. Technical correctness, vocal delivery, facial expressions, and eye contact are outside the initial evaluation scope. A technical discussion can receive coaching on how its assumptions and tradeoffs are explained without the app certifying the proposed solution.

## 2. Confirmed scope

| Area | Pilot decision |
| --- | --- |
| Input | Candidate uploads an existing audio or video recording, up to 60 minutes |
| Processing | Extract playback audio as needed, transcribe, identify speakers, group questions, then coach |
| Continuity | Processing continues when the browser closes, after upload is complete |
| Candidate identity | Candidate confirms which detected speaker or speakers are theirs before coaching |
| Context | Target role required; pasted job description and resume text optional |
| Output | Chronological question threads, supported advice, future answers, and grounded alternatives |
| Evidence | Timestamped transcript citations with audio playback at the cited passage |
| Corrections | Save locally scoped corrections; mark affected advice outdated; explicit reanalysis |
| Saved preparation | Edited proposed answers and up to three preparation priorities per review |
| Retention | Uploaded recording and playback audio remain until the candidate deletes the review |
| Access and usage | Invited accounts; three recordings per candidate; one active processing job per candidate |
| Processing budget | $50 total pilot allowance for transcription, media processing, and coaching; hosting/storage excluded |
| Pilot usability signal | Four of five candidates complete a review and save at least one useful suggestion without facilitator assistance |

The previous text-only first release, 8,000-word/3–10-thread envelope, two-model-call limit, and browser-bound 90-second analysis request are superseded. A full recording may contain more questions; select bounded processing units internally rather than requiring the candidate to prepare excerpts. English remains the initial supported language.

Uploaded file size, accepted container/codec combinations, provider limits, and processing deadlines must be measured and configured before pilot intake. Support a tested set of common exported recording formats; do not promise that every Meet/Zoom export is compatible. The 60-minute limit is a product boundary, not a latency guarantee. Background processing starts after a successful upload; it cannot finish uploading a local file after the browser closes.

## 3. Candidate workflow

1. Sign into an invited account. Start a review with a title, target role, and hiring/mock origin. See remaining recording allowance and supported upload limits.
2. Upload a recording. Explain before upload that recording and playback audio remain until review deletion, and identify external processors before transferring material to them.
3. Optionally paste a job description and resume or up to three experience stories. These are selected background for this review, not evidence of what was said in the interview.
4. Successful upload completion automatically schedules initial processing within the account and budget limits; no second start action is required. See upload progress, followed by processing stages or an explicit waiting state. After upload, leave and return without losing processing. Show actionable errors and partial completion; do not invent a completion-time estimate.
5. Listen to short detected-speaker samples and identify the candidate. Allow multiple interviewers and correction of mistaken speaker assignments. No full-transcript approval is required.
6. Browse the chronological question flow with nested follow-ups and categories. Select a thread to inspect the original answer, suggested future answer, and a short “Why this suggestion” explanation.
7. Inspect exact transcript citations and play the corresponding audio. Correct misheard words, speaker identity, or a question/answer association when relevant. Unclear passages remain visibly uncertain.
8. Save an edited future answer and up to three preparation priorities. Later visits restore the review and saved work.
9. Delete a review when desired. Access disappears immediately; storage cleanup status remains visible until completed.

Use the compact ordered flow rather than a freeform graph editor. Keep original interview evidence, supplied background, generated wording, and candidate edits visually distinguishable. Evidence playback is audio-only for this pilot; synchronized video playback is deferred.

## 4. Transcription, speakers, and uncertainty

The recording is the original source. A machine transcript is an interpretation and may contain errors. Preserve the initial transcript and local corrections separately, with timestamps back to the recording. A corrected transcript does not modify the recording or turn candidate-added facts into past speech.

Candidate speaker confirmation is a prerequisite to coaching. Speaker clustering can split one person into multiple labels; allow the candidate to select more than one label and correct individual passages. An interviewer panel must not be collapsed into the candidate's answer. Unknown and overlapping speech stay visible.

If audio is unintelligible or attribution remains unresolved, withhold claims that depend on that passage, flag it for playback/correction, and continue with supported answers. A question whose essential wording is unclear cannot safely receive a confident question-coverage judgment. Avoid both silent omission and blocking the whole interview because of one uncertain passage.

Group substantive interviewer questions with their responses and follow-ups. Follow-ups may resolve an initial gap; distinguish an incomplete first answer from an unresolved thread. Retain greetings, logistics, candidate questions, and other speech in the transcript even when they do not receive coaching cards.

## 5. Coaching and evidence rules

The question is the primary rubric. Optional job-description text can explain explicit role relevance, but is not the interviewer's hidden scoring system. Do not penalize unrelated missing keywords. STAR is an optional aid, not a required answer template.

Each personal assertion in a proposed answer must be supported by either the interview transcript or selected background. Distinguish:

- What the candidate said in the interview, subject to visible transcription corrections.
- New material drawn from the candidate's selected background for a future answer.
- Questions the candidate must answer before a missing fact can be asserted.

A resume mentioning a migration does not establish leadership or a business metric. Do not invent employers, credentials, events, ownership, numbers, or outcomes. Candidate confirmation is not external verification. Job descriptions cannot establish personal achievements. Imported documents and transcripts are evidence, never instructions to the model.

An alternative story must cite supplied background and explain why it fits the question. If none is supported, improve the current answer, preserve its strengths, or request a specific missing fact. Requests for missing facts are useful outputs, but alone do not satisfy the useful-action coverage metric below.

Citations must resolve to the exact transcript/background version supplied to generation. A matching quote proves a reference exists; it does not prove the recommendation follows from it. Evaluate substantive support separately.

## 6. Corrections, saved work, and recovery

Save transcript corrections immediately and mark affected advice outdated. Candidate edits that add new information beyond the recording belong in selected background, not as a silent transcription correction. Preserve original recording, initial transcript, prior evidence, and saved preparation work.

Reanalysis is an explicit candidate action. Reuse valid preprocessing and unaffected results. A changed target role or selected background may invalidate all advice that used it; a speaker or grouping change may affect more than one thread. When the dependency boundary is uncertain, be conservative about freshness. Other completed advice remains readable with its original evidence.

Keep successful stages if a later stage fails. Retry transient failures within configured attempt and spending limits. Retry only failed or outdated work; never automatically restart an entire transcription because coaching failed. Ambiguous paid-provider outcomes must be reconciled before another submission, to avoid duplicate work and charges. After retries are exhausted, show an explicit retry action and explain what will rerun.

Saving a future answer or priority does not start paid processing. These artifacts are preparation, not observed performance or verified background. No automatic cross-interview recurring themes are included in this pilot.

## 7. Access, allowance, and retention

Authenticate every invited candidate and authorize all review, recording, playback, processing, and deletion operations by owner. Invitation controls and account limits must exist before external use; a fixed development identity is only for loopback development.

Allow three recording admissions per candidate and one active processing job per candidate. Interrupted uploads and technical retries of an admitted recording do not consume another recording allowance. Deleting a processed review does not replenish the allowance. Validate these rules under concurrent requests, not only in the interface.

Set a $50 total pilot processing allowance, including paid extraction/transcoding if used, transcription, coaching, and retries. Reserve conservative cost bounds before accepting paid work; account for all candidates against one shared balance. Stop new paid work when the remaining balance cannot cover it. Hosting/storage charges are separate. This cap is a design requirement, not a claim that fifteen hour-long interviews fit within it. Do not start the pilot until selected provider prices and maximum usage can support enforcement; retain reservations when billing is unknown.

Retain original uploaded recordings, derived playback audio, transcripts, context, and results until review deletion. Explain this at upload. The account owner can delete the whole review. Replacing background excludes it from future use but is not represented as erasing historical copies.

Deletion immediately revokes access, processing publication, and playback. Cancel processing where supported and remove stored original/derived media, transcripts, snapshots, generated results, and saved work. Retry interrupted cleanup; show pending cleanup honestly. Document actual external-provider, workflow-state, and backup retention before pilot launch; application deletion must not be described as erasing copies beyond its control.

Do not log raw recordings, transcripts, resumes, prompts, or secrets. Use permitted material for evaluation and do not send private examples to additional services without authorization for that use.

## 8. Pilot acceptance and quality evidence

Implementation readiness, useful coaching, and demand are separate conclusions. The current repository contains a fictional frontend prototype; these requirements do not claim working backend services or completed evaluation.

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| IC-01 | Recording intake | A supported audio and video file can each complete intake; duration/size/type limits are enforced; upload interruption is recoverable without duplicate admission |
| IC-02 | Transcript and grouping | At least 90% of substantive interviewer questions link to the appropriate responses on a frozen independently labeled corpus; report transcription, attribution, omission, and spurious-group errors separately |
| IC-03 | Grounded recommendations | Citation text/version and audio references resolve; human review separately checks substantive support |
| IC-04 | Useful future answer | Original speech stays separate from supported revision/background additions; preservation or a focused missing-fact request is available when appropriate |
| IC-05 | Useful action coverage | At least 70% of substantive interviewer-question threads receive a specific improvement or preservation action judged supported by independent reviewers |
| IC-06 | Review usability | Candidate confirms their speaker, navigates questions, plays evidence, and saves useful preparation without approving the whole transcript |
| IC-07 | Safe correction | Corrected input marks dependent advice outdated; explicit reanalysis cannot be overwritten by an obsolete result; saved work survives |
| IC-08 | Truthful personalization | No known critical invented personal facts or material ownership misattributions remain in released generation behavior |
| IC-09 | Saved preparation | Edited answers and at most three priorities per review persist across visits; no recurring-theme claim is presented |
| IC-10 | Durable recovery and deletion | Browser closure after upload does not stop processing; failed stages preserve results; deletion prevents late work from recreating accessible data |
| IC-11 | Accessible partial states | Keyboard navigation, playback controls, speaker correction, errors, uncertainty, and outdated/partial states work |
| IC-12 | Pilot limits and isolation | Cross-owner access fails; concurrent admissions/jobs respect limits; all paid attempts require a shared budget reservation |

### Evaluation material and failure rules

The independent corpus and reviewers are not yet established. Use permissioned English recordings representative of supported behavioral and past-project interviews. Have an independent reviewer label speaker attribution and substantive question/response relationships; freeze a held-out portion before tuning. Include audio ambiguity, overlapping speakers, incomplete answers, and follow-ups. Author-created fixtures test implementation but do not establish independent accuracy.

For IC-05, identify substantive questions before reading outputs. Include ambiguous or unanswered questions; exclude only greetings, logistics, and candidate-to-interviewer questions. Report abstentions, disagreements, question types, and sample size. Missing-fact requests alone do not count in the numerator. If coverage is below 70%, report the failure and improve the system or explicitly narrow scope with a new held-out evaluation. Never force unsupported advice to meet coverage.

Invented employers, credentials, metrics, events, and material ownership misattribution are critical defects. Any observed critical defect blocks the affected generation capability until fixed and reevaluated. Track lesser scope overstatements and relevance problems separately. Until independent quality evaluation exists, describe coaching quality as unevaluated; use reviewed examples for external demonstrations. A successful usability pilot is not independent coaching validation.

The earlier major-defect ceiling of 2% across at least 100 independently reviewed personalized recommendations remains a proposed gate for broader unsupervised release, not a sample-size requirement silently imposed on this five-person pilot. Correct all known defects; the ceiling does not authorize false assertions.

### Five-candidate usability signal

Four of five invited candidates should complete their own review and save at least one suggestion they judge useful without facilitator assistance. Speaker confirmation is normal product interaction, not facilitator help. Report all five outcomes, upload/processing failures, corrections, completion effort, saved suggestions, and actual usage/cost. Do not replace unsuccessful participants to improve the fraction.

This is an initial usability signal, not a population estimate, proof of retention, or evidence of improved hiring outcomes. Measure return only when another recording is available; an externally conducted mock supplies input but does not prove routine access to hiring-interview recordings.

### Baseline and product claims

Compare coaching with a competent general-purpose model prompt using the same transcript, role, background, similar output budget, and the same model where feasible. Ask both systems for supported revisions, quoted evidence, and missing facts. Use randomized blinded review by people with relevant interviewing experience. Citation validity and candidate satisfaction alone are not quality labels.

Measure recording-to-saved-answer workflow effort separately from coaching quality. Distinguish the benefit of upload/transcription/evidence navigation from the quality of advice on an identical transcript. A product can earn its place through lower effort even if advice is equivalent; if neither improves, report that result. Competitor feature inventories and marketing claims are not evidence of differentiation.

## 9. Delivery and deferred scope

Selected stack remains Next.js, TypeScript, shadcn/ui, TanStack Query, Zod, Drizzle, Cloudflare Workers/Workers Builds, D1, and private R2. Durable staged execution replaces the prior bounded request. See [ARCHITECTURE.md](ARCHITECTURE.md) and [the scope decision](adr/0001-recording-first-pilot.md).

Build in this order:

1. Verify providers, supported media formats, runtime integration, and bounded processing costs on a permissioned recording; establish invited authentication and isolated environments.
2. Implement private upload, persisted review/media metadata, allowance/budget reservations, owner-scoped playback, and retryable deletion.
3. Add durable media preparation/transcription, visible progress, and candidate speaker confirmation.
4. Add question grouping, cited coaching, and timestamped audio evidence.
5. Add local corrections, stage reuse, saved answers/priorities, and recovery/concurrency tests.
6. Run the five-candidate pilot and separate quality evaluation; report limits and observed failures.

Deferred: Meet/Zoom account connections, meeting bots, live assistance, generated practice interviews, coached retries, synchronized video playback, visual/vocal delivery assessment, technical-correctness verdicts, automatic recurring themes, PDF parsing, social-account connections, crawling, code execution, billing, public sharing, and coach teams.

No deadline or capstone rubric has been supplied. Provider choices, exact integration versions, byte/codec limits, provider retention, and cost feasibility remain implementation prerequisites rather than unresolved product intent. No services have been provisioned by this document.
