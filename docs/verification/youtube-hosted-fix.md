# Hosted YouTube import investigation — 1 October 2026

The original staging attempt failed before transcription. Two diagnostic attempts distinguished a Worker/container transport failure (`Network connection lost`) from a downloader rejection. Their unknown media reservations remain held; no provider costs were invented or cleared.

A later hosted attempt successfully retrieved the supplied `sa41eWwM7iI` video through 38:38: 74,176,044 bytes, 2,318,000 ms, mono 16 kHz PCM. Its source hash was `18440abaf6c2b85bd4d8bb3680cba77d2af83177e0cb31d26d87a834b5b71feb`. This establishes that Cloudflare can retrieve this public video; it does not establish universal YouTube availability.

## Reproduced defect and fix

The container entrypoint handled SIGTERM by closing all connections immediately. Cloudflare deployment rollouts send SIGTERM while allowing applications to finish active requests. Our handler discarded that opportunity and could interrupt an admitted import or conversion, losing its response and leaving its charge unresolved.

`node --test scripts/media-lifecycle.test.mjs` exercises the real entrypoint, a real authenticated HTTP import and real FFmpeg conversion. With the old handler, sending SIGTERM after import starts causes `fetch failed`. With the corrected handler, the request returns HTTP 200 and the complete 32,044-byte one-second WAV, then the process exits with code 0. The existing 120-second absolute lifetime remains in place.

This is a proven shutdown defect matching the observed transport symptom. Historical container logs were not enabled, so it is not proof that SIGTERM caused every earlier failure. The successful hosted retrieval occurred during diagnosis, before the graceful shutdown fix.

## Remaining upstream failure

A separate ten-second import of the same video after the fix deployed failed with a classified HTTP 403 from the downloader, before conversion. The graceful-shutdown fix does not resolve this upstream refusal. URL intake remains intermittent and must not be called fully fixed. No cookies, proxy rotation, authentication bypass, or automatic retry loop was introduced. The UI now distinguishes this refusal from a service connection interruption.

## Diagnostics

Downloader stderr is bounded to the last 16 KiB in memory and converted to finite categories. Raw stderr, video titles, provider URLs and tokens are not logged. The Worker distinguishes downloader failures, transport failures and container exits. Transport failures no longer tell users that the video may be restricted. Staging container observability is enabled. Temporary connection probes have been removed.

## Validation

- Media suite: 14 passed, including the failing-before/passing-after real-process shutdown regression.
- Focused hosted media, YouTube and processing tests: 29 passed.
- Lint and typechecking passed.
- Real full-cutoff hosted retrieval and media encoding passed; provider transcription was still in progress when this evidence was initially written.

Independent coaching quality, the complete saved-answer acceptance, and five-candidate pilot acceptance are separate outstanding criteria.
