# User-supplied mock interview sample — 2026-09-27

The user supplied [Behavioral Mock Interview with Staff ML Engineer](https://www.youtube.com/watch?v=sa41eWwM7iI), published by Andrey Tech, for the blocked recording-dependent tickets. This replaces the absence of any real sample; it does not complete the tickets' other acceptance criteria.

## Scope and provenance

- User-requested scope: interview before 38:40; omit the subsequent feedback.
- Publisher chapter metadata starts feedback at **38:38**. Trim at 2317.9 seconds, leaving a small frame-boundary margin. Measured video duration is **2317.933333 seconds** (38:37.933), strictly before feedback. Audio is 2317.90875 seconds. Both start at original time zero, so interview citations retain the original timeline.
- English automatic captions were retrieved and limited to the interview. They are navigation aids, not the application's transcription result, independent speaker labels, or reference truth. No feedback is used as coaching input, a baseline, or evaluation labels.
- User authorization is recorded in the private manifest with the task ID/date. This records permission to perform the requested sample work, not a claim of participant consent or a redistribution license.
- Media, captions, the development manifest, hashes, and raw preparation evidence are retained locally under `.evaluation-private/sa41eWwM7iI/` in the user's project checkout, outside Git. Do not publish recordings or transcript text in issue bodies or PRs.
- This is one **development** sample, not a frozen held-out corpus. Independent question/answer labels, reviewer declarations and adjudication remain missing. If this sample informs tuning, use separate unseen material for later held-out evaluation.

## Interview coverage

Publisher chapters provide this initial navigation map. These are coarse topic boundaries, not independently checked question/response associations; label individual follow-ups separately before scoring.

| Approximate chapter start | Topic |
| --- | --- |
| 00:20 | Career background and ML experience |
| 01:32 | Leading a difficult technical project |
| 11:49 | Setting team direction and planning |
| 18:18 | Resolving disagreement |
| 24:07 | Responding to a project setback |
| 32:50 | Developing other engineers |
| 36:05 | Learning beyond immediate responsibilities |

No candidate resume or job description was provided. Do not reuse synthetic-test background or assume the first detected speaker is the candidate. Confirm candidate identity separately in both transcription parts.

## Local preparation evidence

Used the actual `extractAudio` and `compressChunks` exports from `scripts/media-adapter.mjs` at staging commit `9178c72226fb45dc8e1fc18dd34f86c0d1302d77`, with each operation bounded by a 75-second abort signal. Runtime: Node 22.19.0, FFmpeg 8.1.2 on macOS.

| Check | Observed result |
| --- | --- |
| Input | H.264/AAC MP4, one stereo 44.1 kHz audio stream; 105,294,526 bytes, below 256 MiB |
| Audio extraction | Passed; standard-header PCM WAV, mono, 16 kHz, 16-bit; 74,173,124 bytes |
| Preparation duration | Extraction 2.315 seconds; extraction plus chunking and evidence collection 8.328 seconds |
| Transcription part 0 | Offset 0 ms; duration 1,200,000 ms; 4,800,609 bytes |
| Transcription part 1 | Offset 1,200,000 ms; duration 1,117,909 ms; 4,472,289 bytes |
| Packed parts | 9,273,056 bytes, below the adapter's 15,000,000-byte limit |
| MP3 decode check | Both parts decode; final part is 1.9375 ms longer than its rounded manifest duration, within one 36 ms MP3 frame. A strict 1 ms comparison failed; no exact sample-count identity is claimed |
| Cutoff | Video and extracted audio end before the feedback chapter and requested 38:40 cutoff |

The downloaded video was trimmed with stream-copied H.264 and re-encoded AAC. It is a YouTube-derived test sample, not evidence for native Meet/Zoom exports. Local extraction is not a deployed upload, browser playback, Cloudflare container, or paid transcription test. No provider charges were incurred by these local preparation operations. No 60-minute boundary, live deletion, coaching accuracy, or pilot outcome is established.

## Ticket implications and next acceptance work

| Ticket | Sample contribution | Still required |
| --- | --- | --- |
| #4 | Real supported video prepared locally using the application adapter | Deployed upload/extraction/playback/deletion, representative export matrix, cost and retention evidence |
| #5 | Real interview WAV plus two prepared parts available for a pipeline run | Durable provider transcription, receipts/cost reconciliation, timestamps/playback and both parts' speaker confirmation |
| #14 | Real behavioral/past-project development example with provenance and scope | Independent labels/reviewers, frozen held-out material, actual app/baseline outputs and blinded ratings |
| #15 | Concrete input for the recording-to-saved-preparation workflow | Complete deployed journey and remaining boundary, concurrency, deletion, accessibility and quality gates |
| #16 | No participant outcome supplied | Five recruited candidates and observed unassisted outcomes after the readiness gates |

Keep all five tickets open. The short transcription smoke test injects synthetic background and guesses a fixture-specific speaker; the hour test requires exactly 3600 seconds and synthetic dialogue. Do not feed this recording into either unchanged and claim real-sample acceptance. A representative run must use only supplied context, verify both parts' candidate labels, preserve provider receipts, and record the actual journey before claiming integration success.
