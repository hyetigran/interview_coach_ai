# Process recordings through durable stages

Full recordings, recoverable partial results, and candidate speaker confirmation require processing to outlive a browser request. Replace the proposed bounded HTTP analysis with Cloudflare Workflows coordinating persisted media preparation, transcription, confirmation, grouping, and coaching stages, using the selected D1 and private R2 storage.

This adds durable dispatch, provider receipts, and cleanup responsibilities in exchange for reusing completed work after failures or browser closure. Retries around paid operations require idempotency or reconciliation and reservations against the shared pilot budget; workflow durability alone cannot guarantee exactly-once external charges. Every publication checks current input and deletion state so a resumed or late operation cannot revive deleted content or overwrite corrected advice.
