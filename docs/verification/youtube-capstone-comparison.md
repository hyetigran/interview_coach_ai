# Debate Coach downloader comparison — 1 October 2026

The preserved Debate Coach checkout at `/Users/tig/.codex/worktrees/8866/capstone` uses yt-dlp's `web_embedded` client for audio downloads, Node for JavaScript execution, and EJS. It also offers a captions-first intake path. Interview Coach already bundles yt-dlp 2026.8.19 and yt-dlp-ejs 0.8.0 in its media image; missing EJS was not the difference.

## Controlled comparison

Using the deployed Linux image locally, the supplied public video downloaded with both the existing default-client configuration and the embedded client. Both returned 43,469,969 bytes of M4A audio. The format was held constant to isolate the client setting. Local success cannot reproduce the hosted IP/environment differences.

The preceding hosted default-client attempt failed with a classified downloader HTTP 403 (see `youtube-hosted-fix.md`). Staging media version `843d2cb7-22bf-4230-9a5b-f4c6ea6e6f35` changes only the client selection to `youtube:player_client=web_embedded`. It retains the canonical video-ID input, direct HTTPS M4A selection, existing bundled EJS, no config/cookies/plugins, bounded lifetime and size, and admission/budget controls. Runtime downloading of remote EJS components is unnecessary.

Two consecutive hosted imports passed with the candidate configuration:

- Ten-second cutoff: review `9e21bdff-50c3-441e-a6be-6dda658758de`, preparation ready.
- Full 38:38 cutoff: review `54194926-5ba5-4f54-99d3-0bf6b5b76a7e`, preparation `prepare-ce6bb734-78be-4821-af7c-45b462b3b5fe`, ready with 74,176,044 bytes, 2,318,000 ms, mono 16 kHz PCM. SHA-256 `18440abaf6c2b85bd4d8bb3680cba77d2af83177e0cb31d26d87a834b5b71feb` matches the earlier successful full-cutoff import.

## Interpretation and scope

The embedded client is a promising compatibility improvement with successful hosted evidence for the user's sample. Because the default client had intermittent success too, these results do not establish that client choice caused every failure or that all public videos now work. The prior shutdown regression remains fixed. No retry loop, proxy, cookies, format broadening, or captions-based substitution was added.

Transcription began after successful preparation. Speaker confirmation, coaching quality and saved-answer acceptance are not established by this downloader comparison. Provider work already in progress should be reused rather than repeated merely to retest downloading.

## Validation

- Media tests: 14 passed, including real FFmpeg conversion, exact cutoff, input rejection and graceful container shutdown.
- Focused YouTube, hosted-media and processing tests: 30 passed. Lint and diff whitespace checks passed.
- Hosted real-video verification: ten-second and full-cutoff imports both reached ready.
- The local HTTP tests require localhost socket permission; the sandbox-only run failed with EPERM and was rerun successfully with that permission.
