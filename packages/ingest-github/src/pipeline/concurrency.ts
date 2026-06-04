export interface ConcurrencyLimiter {
  <T>(task: () => Promise<T>): Promise<T>;
  readonly activeCount: () => number;
  readonly pendingCount: () => number;
}

export function withConcurrency(maxConcurrent: number): ConcurrencyLimiter {
  if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
    throw new Error(`withConcurrency: invalid concurrency=${maxConcurrent}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function drain(): void {
    active -= 1;
    const next = queue.shift();
    if (next !== undefined) {
      next();
    }
  }

  const limiter = <T>(task: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active += 1;
        task()
          .then((value) => {
            drain();
            resolve(value);
          })
          .catch((cause: unknown) => {
            drain();
            reject(cause as Error);
          });
      };
      if (active < maxConcurrent) {
        run();
      } else {
        queue.push(run);
      }
    });
  };

  return Object.assign(limiter, {
    activeCount: (): number => active,
    pendingCount: (): number => queue.length,
  });
}

export interface RunInPoolOptions {
  /**
   * Called whenever a task enters or leaves the active set, with the limiter's live in-flight
   * worker count. Use this to feed `ProgressReporter.setActive(...)` so the bar shows real
   * pool occupancy instead of the cap. Fire-and-forget — exceptions thrown by the callback
   * are swallowed so a buggy reporter doesn't take down the pool.
   */
  onActiveChange?: (active: number) => void;
}

export async function runInPool<T>(
  concurrency: number,
  items: Iterable<T> | AsyncIterable<T>,
  task: (item: T) => Promise<void>,
  opts: RunInPoolOptions = {},
): Promise<void> {
  const limit = withConcurrency(concurrency);
  const fire = (): void => {
    if (opts.onActiveChange === undefined) {
      return;
    }
    try {
      opts.onActiveChange(limit.activeCount());
    } catch {
      // ignore — reporter errors must not abort the pool
    }
  };
  const wrapped = async (item: T): Promise<void> => {
    fire();
    try {
      await task(item);
    } finally {
      // limiter decrements `active` AFTER our finally runs (in drain), so emit (count - 1)
      // to reflect the post-decrement state the next enqueue will see.
      try {
        if (opts.onActiveChange !== undefined) {
          opts.onActiveChange(Math.max(0, limit.activeCount() - 1));
        }
      } catch {
        // ignore
      }
    }
  };
  const promises: Promise<void>[] = [];
  for await (const item of items) {
    promises.push(limit(() => wrapped(item)));
  }
  await Promise.all(promises);
}
