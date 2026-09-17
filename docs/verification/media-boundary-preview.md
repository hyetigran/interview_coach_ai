# Preview video duration boundary — 2026-09-17

This is partial evidence for #4 and #15, not complete pilot or quality acceptance. The fixture is generated silence with a small video frame, not a permissioned interview.

## Reproduce

With the preview runtime configured and FFmpeg installed:

```sh
E2E_MEDIA_BOUNDARY=1 \
E2E_PREVIEW_ORIGIN=https://interview-coach-preview.hyetigran.workers.dev \
pnpm exec playwright test e2e/media-boundary.spec.ts
```

This opt-in test creates invited synthetic accounts and MP4/H.264/AAC recordings at 3600 and 3601 seconds. It uses real upload, Workflows, private media processing, database, storage, and browser playback. It can incur media-processing charges and start automatic transcription. Reviews are deleted after assertions, with bounded best-effort deletion on failure. Temporary local media is removed.

## Observations

The 3600-second case passed twice, each in approximately 1.1 minutes including setup, upload, verification, and deletion. It verified a 115,200,044-byte PCM WAV, 16 kHz mono audio, zero timeline offset, the final two bytes through an authenticated range request, browser duration after reload, and the retained original's SHA-256. The second run also verified that deletion finished its pending cleanup.

The first 3601-second case failed at upload initiation with HTTP 503; it did not exercise duration rejection. The next run reached preparation and exposed a defect: the first adapter response correctly rejected excessive duration, but Workflow replay replaced that reason with an already-submitted error. Preparation now persists the invalid reason and returns it on replay without another adapter call. A regression that recreates the processing module failed before the fix and passed afterward.

After deploying the fix, the 3601-second preview case passed in 58.9 seconds. It verified the visible 60-minute rejection after reload, no eligible retry or published audio, immediate access denial after deletion, and eventual cleanup completion. The full application suite passed 164 tests with three opt-in provider skips; lint, typechecking, and both code-review axes passed.

The first successful hour-long run left two media reservations totaling $0.20 unsettled. These are conservative reservations, not measured charges. Hosting and storage costs are separate. The test does not claim full-length transcription or coaching success.

## Still required

Keep #4 open for representative exported interview recordings, the remaining deployed format/error/deletion matrix, and cost reconciliation. Keep #15 open for the full 60-minute audio and video journey through saved preparation and all its other criteria. Synthetic silence does not establish transcription accuracy, speaker attribution, independent coaching quality, or candidate usability.
