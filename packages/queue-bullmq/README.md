# `@bb/queue-bullmq`

BullMQ-over-Redis implementation of `@bb/queue-core`'s `IQueueProvider`.

## Tier

Strategy. Registers itself with `@bb/queue` via side-effect import as the `"bullmq"` provider.

## Responsibilities

- Implements `IQueueProvider` by wrapping BullMQ `Queue`, `Worker`, and `QueueEvents` against the Redis connection options from `@bb/redis`.
- Owns the Redis lifecycle: `connect()` calls `connectRedis()`, `close()` calls `closeRedis()`, `ping()` calls `pingRedis()`.
- Maps `JobPriority` (Low/Normal/High) to BullMQ's smaller-number-wins ordering (1000/100/10).
- Computes the stable dedupe `jobId = ${type}-${knowledgeId}` so re-publishing is a no-op.
- Settles per-repo logs (`@bb/logger`'s `settleRepoLog`) at terminal states: the worker's `completed` event (success), its `failed` event once `attemptsMade >= attempts` (retries exhausted), and on cancellation. Mid-retry failures are left so the in-flight `repos/<label>.log` stays until the job is truly done.

## Public Exports

```ts
// Registers "bullmq" provider via side effect; no runtime exports.
import "@bb/queue-bullmq";
```

## Invariants (preserved from the previous `@bb/queue`)

1. **One BullMQ `Queue` per `JobType` constructed at `connect()`.**
2. **Queue prefix `"bb"`** to keep dev Redis collision-free with the kube-package reference's `"kp"`.
3. **`removeOnComplete: true`, `removeOnFail: false`, `attempts: 3`, `backoff: fixed/5000`** — unchanged.
4. **Workers close before queues** in `close()` so in-flight jobs finish before connections drop.
5. **Dedupe key is `${type}-${knowledgeId}`** — re-publishing returns the same `jobId`.

## External Dependencies

- `bullmq` (queue runtime)
- `@bb/redis` (shared ioredis options + lifecycle)
- `@bb/queue-core` (interface), `@bb/queue` (registry), `@bb/types`, `@bb/config`, `@bb/errors`

## What is intentionally out of scope

- The publisher entry-points (`enqueueGithubIndex` etc.) live in `@bb/queue`, not here. This package only implements `IQueueProvider.enqueueRaw`.
- DLQ inspection beyond `listFailedJobs()` (no auto-retry, no purge — surfaced via `bytebell ls --failed`).
