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
