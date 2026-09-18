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

The first preview audio probe uploaded all 22 parts (115,200,044 bytes) and
prepared the 3600-second recording. Transcription reached `failed` with a zero
settled transcription charge. A direct diagnostic using the same synthetic audio
encoded as 32 kbps MP3 reproduced HTTP 400, `invalid_value`, with the message
“Audio file might be corrupted or unsupported.” The same hour-long audio in AAC/M4A returned an explicit HTTP 400:
“audio duration 3600.0 seconds is longer than 1400 seconds which is the maximum
for this model.” Its diagnostic reservation settled to zero. A 20-minute MP3
comparison lost its response to a client header timeout; its outcome is unknown
and its $6 reservation remains held. Client-side chunking is required before this
model can satisfy the 60-minute requirement. The browser test was interrupted after the persisted terminal failure;
it did not complete the journey. Final committed assertions and video remain
unverified. Do not treat the test's existence as completed full-length acceptance.

The part-compression groundwork is verified locally: the private media route can
emit three independently decodable MP3 parts of at most 1200 seconds. A real
Linux container limited to 0.25 CPU and 1 GiB compressed the synthetic hour to
14,402,053 bytes; decoding all parts produced exactly the original hour's sample
count. Authentication, browser-origin denial, non-root execution, and corrupt
input rejection passed in the same run. This verifies preparation, not provider
transcription or speaker attribution across parts.

The durable part store records immutable source/timeline identities, serializes
paid submissions, blocks progress after an unknown outcome, preserves completed
parts on retry, and retains known charges after cancellation. A forced concurrent
initialization regression reproduced conflicting persisted manifests; an atomic
manifest claim fixed it. Nineteen focused store/protocol tests, lint, and type
checks pass, with both review axes clear for this groundwork. The coordinator,
receipt recovery, incremental billing, speaker confirmation, and preview
end-to-end verification remain incomplete. No runtime deployment or remote
migration includes this groundwork yet.
