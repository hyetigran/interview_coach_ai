# Full-length pipeline verification

`e2e/hour-pipeline.spec.ts` is an opt-in paid integration test. It requires an
exactly 3600-second source containing the synthetic two-speaker dialogue used in
the shorter provider smoke check, including the candidate's event-driven-service
answer and speech after 3500 seconds. Repeated synthetic dialogue tests runtime
length and the application path; it is not a representative interview corpus or
independent transcription/grouping/coaching quality evidence.

Run audio and video separately to identify stage failures and keep actual usage
visible in the shared processing ledger:

```sh
E2E_PREVIEW_ORIGIN=https://interview-coach-preview.hyetigran.workers.dev \
E2E_HOUR_AUDIO=/private/path/hour-standard.wav \
pnpm exec playwright test e2e/hour-pipeline.spec.ts --grep 'audio reaches'

E2E_PREVIEW_ORIGIN=https://interview-coach-preview.hyetigran.workers.dev \
E2E_HOUR_VIDEO=/private/path/hour.mp4 \
pnpm exec playwright test e2e/hour-pipeline.spec.ts --grep 'video reaches'
```

Preflight uses ffprobe to enforce duration and stream kind before creating a
review or starting paid work. WAV must additionally satisfy the app's standard
44-byte PCM header requirement. Video must produce a distinct playable derivative.
The browser uploads the whole file, leaves and returns, confirms a detected
candidate label, and observes grouping and coaching. Assertions require a
nonempty proposed answer with resolved interview citations. Saved answer and
priorities use real authenticated APIs, followed by browser reload checks and
deletion cleanup.

This is partial ticket #15 evidence. API saves do not establish keyboard editing
and saving; the test does not yet cover question navigation, correction, all
candidate labels, or all loading/error states. A segment after 3500 seconds proves
late-recording reach, not continuous coverage or correct attribution. Real
permissioned recordings and independent evaluation remain outstanding.

Execution results are pending. Do not treat the test's existence as a completed
full-length acceptance check.
