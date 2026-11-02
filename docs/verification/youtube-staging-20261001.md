# YouTube staging rollout — 1 October 2026

PR #50 was merged into staging as `5ddfc4b72993d75743ded14cc64d6a6f59c82fcf`. Migration 0033 and all three runtime components deployed successfully:

- Media: `f1e941ff-966e-44a7-a351-57cea88bca9a`
- Jobs: `be033a9b-76f9-480c-b272-be70545ea95d`
- App: `e91eb733-6a1e-44e6-9152-169a1b12831b`

The staging site is https://interview-coach-preview.hyetigran.workers.dev. Production was not deployed.

## Real hosted attempt

An invited acceptance account created review `925b5c5c-cf31-4c56-afc6-916fdbc52497`. The supplied YouTube video `sa41eWwM7iI` was submitted with endSeconds 2318 (38:38, before publisher feedback). An initial request during deployment propagation returned 404; resubmitting to the same review was accepted with validating state. One media attempt was admitted.

Preparation entered running and then failed: “YouTube import could not finish. The video may be unavailable or restricted. Retry, or upload a recording file.” The media completion timestamp is persisted, so this was an admitted, completed media attempt, not an account allowance rejection. The current implementation discards downloader stderr and returns a generic error; this evidence does not establish the root cause or prove a YouTube network restriction.

No transcript, question groups, coaching, or saved answer was produced by this run. No paid retry was submitted. The $0.10 media reservation remains held pending billing reconciliation; a completion marker is not an actual-cost receipt. Credentials and API snapshots remain in the private evaluation directory.

## Outstanding

Hosted URL import is not accepted as working end to end. Next engineering step: capture bounded, sanitized downloader failure categories, then fix the diagnosed issue and repeat the hosted test. Do not require the user to download/re-upload as the normal URL intake flow. Transcription/coaching/saved-answer acceptance and tickets #4, #5, #14, #15, and #16 remain open. Local Docker success does not supersede this hosted failure.

## Investigation follow-up

PR #51 merged into staging as `4c6fbbf8949c7541d52b22eeeac21dbcc4e32a84`. The active-request shutdown bug is fixed and covered by a real-process SIGTERM regression. Media version `181db315-f770-44af-afca-9c5a5aba0ef3` and jobs version `409b4476-a00b-4312-80cf-952fe7289b24` were deployed. All 224 application tests and 14 media tests passed; CI including browser tests passed.

A full-cutoff hosted import succeeded during diagnosis in review `931aaed8-eb23-425d-8940-44484e8c1375`, with 2,318,000 ms / 74,176,044 bytes. Its first transcript part completed. Cloudflare then reported an internal Workflow error; the errored workflow was restarted using persisted parts without repeating the completed provider request.

A separate ten-second post-fix import failed with classified downloader HTTP 403. This remains unresolved. The feature is not accepted as reliable; there was no proxy rotation, cookie injection, or automatic paid retry loop. Unknown media reservations remain held.
