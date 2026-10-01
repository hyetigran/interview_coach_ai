# YouTube intake verification — 2026-09-28

The recording form accepts a YouTube video link and an optional stop time. The authenticated request reserves the existing recording allowance and persists the preparation job atomically; dispatch is attempted immediately and the scheduled reconciler repairs interruptions. The private media service retrieves the audio and the normal transcription pipeline follows. No browser download/re-upload is required.

## Local evidence

- The real supplied video (`sa41eWwM7iI`) imported through exactly 38:38 into a standard-header, mono 16 kHz PCM WAV: 74,176,044 bytes. Direct adapter execution took 9.341 seconds.
- A local development-server browser journey passed: paste URL, set stop time, import, leave, return, verify 2318-second playback, submit the same link again without consuming a second admission, reload and delete. No OpenAI key was configured.
- The same journey passed against the compiled local Worker. Its output also included network-loss, enqueue and canceled/hung-request diagnostics in OpenNext's response bridge; passing assertions do not establish those diagnostics are resolved. They are not evidence of a failed imported recording or a successful provider transcription.
- Full app regression suite: 220 passed, three opt-in provider cases skipped. Final focused YouTube suite: six passed, including additional late-duplicate and failed-response completion regressions.
- Media suite: 12 passed, including actual FFmpeg format/boundary checks and YouTube validation, size rejection and precise trimming.
- The rebuilt Linux/amd64 media image imported the real video through 38:38 in 40.791 seconds at 0.25 CPU and 1 GiB RAM, with a read-only filesystem and 512 MiB temporary volume. It ran as non-root UID 1000 and returned exactly 74,176,044 bytes, inside the existing 75-second operation limit. This used local Docker networking, not Cloudflare egress.
- Lint, typechecking and the OpenNext Worker build passed. Build output includes a dependency-generated duplicate-key warning in the auth bundle.

## Acceptance limits

This verifies local intake/preparation, persisted playback and application access revocation. It does not establish deployed YouTube reachability, live provider transcription or coaching quality, physical erasure across every provider, the full 60-minute link journey, or pilot acceptance. Existing #4, #5, #14 and #15 acceptance remains open where those criteria are outstanding.

Deploy migration 0033, the rebuilt media container/Worker, the job Worker and the app together to preview before claiming the feature is available there. YouTube may deny requests from hosted networks; show the existing retry/file option instead of bypassing authentication. Only YouTube canonical IDs enter the downloader; no cookies, arbitrary source URLs or general URL import are supported.
