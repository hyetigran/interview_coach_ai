# Multipart preview verification — 2026-09-20

This is partial evidence for #5, #13, and #15. None is closed by this report.

The preview database has migration 0032. The reviewed PR #42 app build passed;
the separate media service was deployed as `f555ee64-9743-4f00-b887-590b0f54a833`
and the job Worker as `8beb4828-361c-4dce-be6b-9a2214c2d3fc`.

## Synthetic hour-long audio probe

A standard 16 kHz mono PCM WAV contained exactly 3600 seconds and 115,200,044
bytes. Two locally synthesized voices supplied a 42.367-second question/answer
exchange at seconds 10, 1140, 1210, 2340, 2410, and 3540. The remaining audio was
silence. The source has no private interview content. This sparse repeated
fixture tests runtime length and late speech, not continuous interview quality.

The opt-in `e2e/hour-pipeline.spec.ts` audio run lasted 7.6 minutes and **failed**
before saving preparation. All 22 upload parts and media preparation completed.
Three distinct transcription parts reached ready and produced 68 utterances,
including speech after 3500 seconds. Browser navigation/reload and confirmation
of candidate labels in all three parts passed. Grouping and coaching reached
ready, but every coaching result withheld its proposal, so the required cited
future-answer assertion failed. No saved-preparation success is claimed.

Provider receipts settled transcription to 90,853 ledger units ($0.090853):
30,535, 30,243, and 30,075 units for the respective parts. This is known
transcription usage only, not total processing, hosting, or storage cost. Earlier
unresolved reservations were retained. The test requested deletion in its final
cleanup; part tombstones retained these charges while becoming cancelled.

## Defect exposed

Six adjacent same-speaker segment pairs overlapped by 82–196 ms in the returned
timestamps. The parser labeled all 12 affected passages as overlapping speech.
That made every question thread uncertain and caused deterministic withholding.
The fixture's sequential voice tracks contain no simultaneous speakers.

The fix distinguishes same-speaker timing uncertainty from overlapping different
or unknown speaker labels. Both remain visible; approximate timing alone does
not invalidate otherwise grounded text and attribution. A bounded bidirectional
scan also flags enclosing cross-speaker ranges correctly. Parser/evidence tests
cover this case, nested ranges, and unknown speakers. Deployed full-hour audio
and video acceptance must be repeated after the fix; independent recordings,
labeling, quality comparison, and pilot candidates remain outstanding.

Two video attempts after the timing fix stopped before upload. The second trace
established that the initial media-state response took 32.484 seconds: status
awaited a global storage-cleanup sweep before returning. Neither attempt reached
paid processing. File selection now stays disabled while recording state loads;
a local browser regression verifies that guard and the subsequent upload flow.
The server status and initialization paths now retire only the current review's
expired leases in SQL. Scheduled cleanup retains the global object sweeps and
late-write tombstones. A media regression verifies that status and replacement
initialization do not call storage cleanup, expired reservations release, and a
subsequent sweep still removes the expired object.

## Video probe after request-path fix

Preview app `6d5782ed-4b4d-4ea0-b203-b222126705fc` ran with the timing-fix job
Worker `5b4b6282-d874-473d-9323-08216b33467c` and the same media service.
The synthetic H.264/AAC MP4 was exactly 3600 seconds and 1,632,319 bytes.
Media-state requests in the browser trace took 163–861 ms. Upload, video audio
extraction, all three transcription parts, late speech, reload, and candidate
confirmation passed. One completed coaching result contained six cited segments.

The run nevertheless **failed** after seven minutes: grouping finished partial,
with two sections ready and the third unable to publish its saved provider
response against the evidence. No paid grouping request was repeated. The
underlying validation failure has not been isolated; this result does not prove
full video acceptance or saved preparation. The test's deletion cleanup produced
a non-null upload `cleaned_at`; a later fetch found its grouping receipt absent.

Known transcription usage settled to 90,690 units ($0.090690), and the three
grouping calls to 1,692, 1,924, and 1,750 units. Two media reservations of 100,000
units each remain unresolved. These figures exclude coaching and hosting/storage;
they are not a total cost claim. Unresolved reservations remain held.

The complete local suite after the request-path fix passed 214 tests, with three
provider-only tests skipped. Type checking, lint, and the Worker build passed;
both code-review axes reported no blocking findings.

## Additional recovery probes

The isolated deployed `stage-recovery.spec.ts` suite passed both scenarios in
3.3 minutes: recovering preparation from saved artifacts and publishing a saved
transcript. The fixtures verified duplicate actions, stable artifact identity,
reload, deletion/retry denial, and zero settled provider cost. These seeded
synthetic receipts exercise recovery, not actual provider reliability.

The deployed grouping and coaching retry scenarios in `analysis-recovery.spec.ts`
also passed (1.8 and 1.2 minutes). Their candidate-only/incomplete-evidence inputs
avoid provider calls; each retry ledger settled to zero. These are focused smoke
checks, not complete failure-injection coverage for #13.

## Audio repeat and fixture limitation

The audio repeat failed after 8.9 minutes. All three transcription parts were
ready, but the grouping run was still `running` after the three-minute wait, with
two sections in receipt reconciliation and one ready. Saved synthetic receipts showed a changed source identifier and a quote
that did not occur in its referenced utterance; validation rejected them.
The saved candidate selection also omitted Part 1's candidate label even though
the test intended to select it. The fixture pressed the first checkbox while its
fieldset was still disabled by the speaker-state request. The fixture now waits
for each checkbox to become enabled, asserts it is checked, and verifies the
persisted selection before continuing. This run cannot count as successful
speaker confirmation or full audio acceptance. Provider diarization also assigned
one Part 2 label to both question and answer speech, so phrase matching alone is
not reliable attribution evidence. A permissioned recording and correction checks
remain necessary; these synthetic failures are not independent quality scores.

The deployed late-artifact cleanup check also passed (1.5 minutes): deletion
rejected issued upload capabilities and subsequent access, and scheduled cleanup
removed injected late originals, derivatives, and transcript artifacts. This
injects storage writes; it does not simulate a live provider cancellation race.

The audio failure exposed a finalization race: Workflow completion can observe a
section publishing a receipt and leave its run running; failed publication did
not recheck the aggregate. Receipt recovery now rechecks finalization on both
success and failure. A gated regression races those operations and requires a
partial run, the earlier ready group, retained billing, and no additional provider
request after publication fails.

On 2026-09-20 the user deferred tickets and acceptance work requiring sample
interviews. The hour probes above are historical failures, not prerequisites for
continuing the remaining recovery implementation. No further sample-interview
runs or independent evaluation are claimed by this follow-up.
