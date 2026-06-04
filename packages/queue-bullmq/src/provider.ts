// BullMQ-over-Redis implementation of `IQueueProvider`. Registers itself
// as the "bullmq" provider at module load; the server picks it up via
// `import "@bb/queue-bullmq"` (side effect) + `connectQueue("bullmq")`.

import { Queue, Worker, type Job } from "bullmq";
import { JobType, type JobMessage, type PayloadFor } from "@bb/types";
import { QueueConnectError, QueueNotConnectedError } from "@bb/errors";
import { settleRepoLog } from "@bb/logger";
import { connectRedis, closeRedis, pingRedis, getRedisConnection } from "@bb/redis";
import { defaultConcurrencyFor, registerQueueProvider } from "@bb/queue";
import type {
  FailedJob,
  IQueueProvider,
  JobHandler,
  NormalizedEnqueueOptions,
  QueuePingResult,
  RemoveKnowledgeJobsResult,
  WorkerRegistrationOptions,
} from "@bb/queue-core";
import { dedupeKey, mapBullmqPriority } from "./priority.ts";

// Distinct from the kube-package reference's `"kp"` so a shared dev Redis can
// host both without key collisions.
const QUEUE_PREFIX = "bb";

const ALL_JOB_TYPES: readonly JobType[] = [JobType.GithubIndex, JobType.GithubPull, JobType.LocalIngest];

// Retain failed jobs (`removeOnFail: false`) so `listFailedJobs()` can surface
// them; drop completed jobs to keep Redis small. BullMQ tracks attempts
// internally — workers don't need to.
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: false,
  attempts: 3,
  backoff: { type: "fixed", delay: 5000 },
} as const;

class BullmqQueueProvider implements IQueueProvider {
  private queues = new Map<JobType, Queue>();
  private workers: Worker[] = [];

  async connect(): Promise<void> {
    // The provider owns its substrate lifecycle (mirroring `@bb/sqlite`
    // owning `connectSqlite`). The server's `main()` no longer calls
    // `connectRedis()` directly.
    await connectRedis();
    try {
      // One `Queue` per job type. BullMQ spawns its own internal ioredis
      // client per Queue from the options blob (see §10.3 of
      // `docs/redis-and-queue.md`), so the connection object is shared
      // shape, not a shared connection.
      const connection = getRedisConnection();
      for (const type of ALL_JOB_TYPES) {
        const queue = new Queue(type, {
          connection,
          prefix: QUEUE_PREFIX,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
        this.queues.set(type, queue);
      }
    } catch (cause: unknown) {
      this.queues.clear();
      throw cause instanceof QueueConnectError ? cause : new QueueConnectError(cause);
    }
  }

  async close(): Promise<void> {
    // Workers first so in-flight handlers finish before BullMQ's internal
    // Redis connections drop. Reversing this order would corrupt active
    // jobs (BLPOP commands would error mid-claim).
    const ws = this.workers.splice(0);
    await Promise.all(ws.map((w) => w.close()));
    const qs = Array.from(this.queues.values());
    this.queues.clear();
    await Promise.all(qs.map((q) => q.close()));
    await closeRedis();
  }

  async ping(): Promise<QueuePingResult> {
    return pingRedis();
  }

  async enqueueRaw<T extends JobType>(
    type: T,
    message: JobMessage<PayloadFor<T>>,
    opts: NormalizedEnqueueOptions,
  ): Promise<string> {
    const queue = this.requireQueue(type);
    // Stable `jobId` is the load-bearing dedupe primitive: BullMQ silently
    // drops a second `queue.add(...)` with the same id, so re-publishing
    // the same `(type, knowledgeId)` is a no-op.
    const jobId = dedupeKey(type, message.knowledgeId);
    await queue.add(type, message, {
      jobId,
      priority: mapBullmqPriority(opts.priority),
    });
    return jobId;
  }

  registerWorker<T extends JobType>(type: T, handler: JobHandler<T>, opts: WorkerRegistrationOptions = {}): void {
    if (this.queues.size === 0) {
      throw new QueueNotConnectedError();
    }
    const concurrency = opts.concurrency ?? defaultConcurrencyFor(type);
    const worker = new Worker(
      type,
      async (job: Job<JobMessage<PayloadFor<T>>>) => {
        await handler(job.data);
      },
      {
        connection: getRedisConnection(),
        prefix: QUEUE_PREFIX,
        concurrency,
      },
    );
    // Terminal signals for per-repo log settling (no-op for payloads without a
    // per-repo log). `completed` = success; `failed` only settles once retries
    // are exhausted, so a repo mid-retry stays "in progress" in repos/.
    worker.on("completed", (job: Job<JobMessage<PayloadFor<T>>>) => {
      settleRepoLog(job.data.knowledgeId);
    });
    worker.on("failed", (job: Job<JobMessage<PayloadFor<T>>> | undefined) => {
      if (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        settleRepoLog(job.data.knowledgeId);
      }
    });
    this.workers.push(worker);
  }

  async removeKnowledgeJobs(knowledgeId: string): Promise<RemoveKnowledgeJobsResult> {
    let removed = 0;
    for (const type of ALL_JOB_TYPES) {
      const queue = this.queues.get(type);
      if (queue === undefined) {
        continue;
      }
      // The dedupe key is deterministic — direct lookup, no scan.
      const jobId = dedupeKey(type, knowledgeId);
      const job = await queue.getJob(jobId);
      if (job === undefined || job === null) {
        continue;
      }
      try {
        await job.remove();
        removed += 1;
      } catch {
        // BullMQ throws when removing an `active` job — the worker holds it.
        // Leave it; the handler is idempotent and will finish naturally.
      }
    }
    // Cancellation is terminal — fold any in-flight per-repo log into archive/.
    settleRepoLog(knowledgeId);
    return { removed };
  }

  async listFailedJobs(): Promise<FailedJob[]> {
    const out: FailedJob[] = [];
    for (const [type, queue] of this.queues) {
      const failed = await queue.getJobs(["failed"]);
      for (const job of failed) {
        out.push(normalizeFailed(type, job));
      }
    }
    return out;
  }

  private requireQueue(type: JobType): Queue {
    const q = this.queues.get(type);
    if (q === undefined) {
      throw new QueueNotConnectedError();
    }
    return q;
  }
}

function normalizeFailed(type: JobType, job: Job): FailedJob {
  const data = job.data as JobMessage<unknown> | undefined;
  const knowledgeId = typeof data?.knowledgeId === "string" ? data.knowledgeId : "";
  const failedAtMs = typeof job.finishedOn === "number" ? job.finishedOn : Date.now();
  return {
    id: String(job.id ?? ""),
    type,
    knowledgeId,
    attempts: job.attemptsMade ?? 0,
    failedAt: new Date(failedAtMs).toISOString(),
    reason: job.failedReason ?? "",
    payload: data?.payload ?? null,
  };
}

registerQueueProvider("bullmq", () => new BullmqQueueProvider());
