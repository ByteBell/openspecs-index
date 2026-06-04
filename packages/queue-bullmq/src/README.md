# `@bb/queue-bullmq/src` — context

Implementation of the BullMQ-over-Redis provider that registers itself with `@bb/queue` as `"bullmq"`. See [../README.md](../README.md) for the package-level contract.

## Files

- **[index.ts](index.ts)** — single side-effect import of `./provider.ts`. Importing the package as `import "@bb/queue-bullmq"` triggers provider registration.
- **[provider.ts](provider.ts)** — `BullmqQueueProvider` class implementing `IQueueProvider`. Owns the BullMQ `Queue` map, the registered `Worker[]`, the Redis lifecycle (`connectRedis` / `closeRedis` / `pingRedis`), the queue prefix (`"bb"`), and the default job options (`attempts: 3`, fixed 5s backoff, `removeOnComplete: true`, `removeOnFail: false`). Registered as `"bullmq"` via `registerQueueProvider` at module load.
- **[priority.ts](priority.ts)** — `mapBullmqPriority(JobPriority)` returns BullMQ's smaller-number-wins numeric priority (Low=1000, Normal=100, High=10). `dedupeKey(type, knowledgeId)` returns the stable `${type}-${knowledgeId}` BullMQ jobId.

## Module dependency graph

```
priority.ts → @bb/types
provider.ts → bullmq, @bb/types, @bb/errors, @bb/logger, @bb/redis,
              @bb/queue (registerQueueProvider, defaultConcurrencyFor),
              @bb/queue-core (IQueueProvider + shared types),
              priority.ts
index.ts    → provider.ts (side effect only)
```

No cycles. `priority.ts` is a leaf within the package.

## Invariants enforced here

- **One `Queue` per `JobType` constructed at `connect()`.** Three queues (`GithubIndex`, `GithubPull`, `LocalIngest`) — `BusinessContextProcessing` is a worker-only concern in OSS and is not in this provider's `ALL_JOB_TYPES`.
- **Queue prefix is `"bb"`.** Stays distinct from the kube-package reference's `"kp"` so a shared dev Redis can host both without key collisions.
- **`removeOnComplete: true`, `removeOnFail: false`, `attempts: 3`, `backoff: fixed 5s`** — unchanged from the original `@bb/queue/src/manager.ts`.
- **Workers close before queues** in `close()` so in-flight handlers finish before BullMQ's internal Redis connections drop.
- **Redis lifecycle is owned here.** `connect()` calls `connectRedis()`; `close()` calls `closeRedis()`; `ping()` calls `pingRedis()`. The server no longer touches Redis directly.
- **Dedupe key is stable.** Re-publishing the same `(type, knowledgeId)` returns the same `jobId` — BullMQ silently dedupes.
- **No env reads.** Redis URL comes via `@bb/redis.getRedisConnection()` (which reads `Config.RedisUrl`). Repo-wide ESLint rule blocks `process.env`.

## Side-effect import

The provider self-registers at module load. The server's composition root does:

```ts
import "@bb/queue-bullmq"; // registers "bullmq"
import "@bb/queue-honker"; // registers "honker" (future)
// ...
await connectQueue(getConfigValue(Config.QueueProvider));
```

Nothing in this package is exported by name; consumers go through the `@bb/queue` facade.
