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
The browser uploads the whole file, leaves and returns, confirms detected
candidate labels in all three parts, and observes grouping and coaching. Assertions require a
nonempty proposed answer with resolved interview citations. Saved answer and
priorities use real authenticated APIs, followed by browser reload checks and
deletion cleanup.

This is partial ticket #15 evidence. API saves do not establish keyboard editing
and saving; the test does not yet cover question navigation, correction, all
candidate labels outside the fixture phrase, or all loading/error states. A segment after 3500 seconds proves
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


Transcript assembly now validates complete contiguous part coverage, retains
original timestamps, and namespaces each provider request's speaker labels.
Passages within two seconds of processing cuts carry explicit uncertainty through
automatic and manual question evidence. The transcript UI explains these markers;
speaker confirmation explains that labels must be selected separately in each
part where the candidate speaks. These helpers are not yet connected to the
provider coordinator. Full-length runtime acceptance remains outstanding.

Saved aggregate receipts can now pass through publication and historical billing
reconciliation. Their application-owned envelope binds the paid attempt and
records that attempt's explicit charge, while preserving the assembled transcript
and boundary markers. Provider JSON cannot opt into this internal format. A local
D1/R2 regression recovered a saved aggregate without provider requests, preserved
its evidence, and left the earlier attempt's charge unchanged. Twenty-seven
focused receipt/transcription tests pass and both review axes are clear. The
coordinator that creates these receipts from completed parts is still pending.

The multipart coordinator is connected for recordings longer than 1400 seconds.
It compresses once, saves audio under the upload's cleanup prefix, and submits at
most one part per invocation using a durable paid identity. Three bounded
Workflow steps can complete an hour; completed parts survive explicit retries,
whose reservation covers only unfinished parts. Local D1/R2 tests with mocked
provider responses verify complete-hour assembly, one compression, unique paid
calls, unknown-outcome blocking, cancellation accounting, incremental retry,
configuration loss, and dispatch expiry after progress. A legacy cancellation
race also retains its unresolved reservation. Both review axes cleared the
focused coordinator fixes. Per-part receipt reconciliation, durable continuation
after interruption, comprehensive historical billing/cleanup, and real full-hour
provider verification remain required before this feature can be accepted.

Multipart billing reconciliation now reads saved per-part usage without
publishing transcript content. Active partial work retains its reservation;
stopped attempts settle only known charges. Deletion reconciles billing before
removing all bounded attempt/part receipt paths and registered part audio, and
retains tombstones so later writes can be swept again. Storage read failures stop
cleanup; malformed or absent usage leaves the charge reserved while deletion can
remove the content. Media cleanup invokes the same path before marking an upload
cleaned, so an unreadable billing receipt remains visible as pending deletion.
Durable part-content recovery/resume and full-hour provider acceptance remain
outstanding.

An over-reservation receipt initially blocked cleanup by failing settlement.
The regression now verifies that requested deletion removes its content while
leaving the reservation unresolved. This does not reconcile the overage or make
the local reservation a provider-enforced spending limit.

## Individual receipt recovery and continuation

Recovery now consumes saved individual part receipts under the original paid
identity, including when the combined receipt was never written. Exhausted
recovery can reopen a bounded publication window when a late individual receipt
arrives. Recovering only part of a recording atomically records a continuation
intent alongside the queued state; the existing scheduled dispatcher resumes
unfinished parts in a new Workflow with the same paid attempt. A crash after
receipt consumption can reconstruct that intent from completed and queued parts.
Undispatched continuation expiry reports failure and reconciles completed usage;
starting work acknowledges dispatch so an old intent cannot stop later parts.

Local database/storage regressions cover these cases without new requests for
completed parts. These tests use synthetic provider responses. They do not prove
full-hour provider completion, production spending bounds, independent quality,
or the five-candidate pilot. The multipart migration and runtime changes still
require isolated deployed acceptance before #5, #13, or #15 can close.
