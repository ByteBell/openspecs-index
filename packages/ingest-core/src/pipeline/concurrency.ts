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

export async function runInPool<T>(
  concurrency: number,
  items: Iterable<T> | AsyncIterable<T>,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const limit = withConcurrency(concurrency);
  const promises: Promise<void>[] = [];
  for await (const item of items) {
    promises.push(limit(() => task(item)));
  }
  await Promise.all(promises);
}
