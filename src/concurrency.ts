/**
 * Bounded-concurrency primitives for rate-limiting provider calls.
 *
 * Two classes:
 * - `ConcurrencyPool`: generic bounded-concurrency executor (FIFO slot queue)
 * - `ProviderConcurrencyRegistry`: lazily creates per-provider pools with
 *   configurable limits, for use with `AiClient`
 */

type Waiter = { resolve: () => void; reject: (reason: unknown) => void };

const DEFAULT_UNKNOWN_PROVIDER_LIMIT = 3;

export class ConcurrencyPool {
  private _active = 0;
  private readonly queue: Waiter[] = [];
  private _limit: number;

  constructor(limit: number) {
    if (limit < 1) throw new RangeError("ConcurrencyPool limit must be >= 1");
    this._limit = limit;
  }

  get active(): number {
    return this._active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  get limit(): number {
    return this._limit;
  }

  set limit(value: number) {
    if (value < 1) throw new RangeError("ConcurrencyPool limit must be >= 1");
    this._limit = value;
    this.drain();
  }

  /**
   * Acquire a concurrency slot. Returns a release function.
   * Use for long-lived operations (streams) where you need manual control.
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (this._active < this._limit) {
      this._active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this._active--;
        this.drain();
      };
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          cleanup();
          this._active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this._active--;
            this.drain();
          });
        },
        reject: (reason: unknown) => {
          cleanup();
          reject(reason);
        },
      };

      const onAbort = () => {
        const idx = this.queue.indexOf(waiter);
        if (idx !== -1) this.queue.splice(idx, 1);
        waiter.reject(new DOMException("Aborted", "AbortError"));
      };

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  /**
   * Wait for a slot, execute fn, release on settle.
   * Rejects immediately with AbortError if signal is already aborted or fires while waiting.
   */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Bounded-concurrency map with allSettled semantics.
   * One failure doesn't abort the rest. On signal abort, in-flight items
   * finish but no new items start.
   */
  async map<T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
    opts?: { signal?: AbortSignal },
  ): Promise<PromiseSettledResult<R>[]> {
    const signal = opts?.signal;
    const results: Promise<R>[] = [];

    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) {
        // Fill remaining slots with rejection
        for (let j = i; j < items.length; j++) {
          results.push(
            Promise.reject(new DOMException("Aborted", "AbortError")),
          );
        }
        break;
      }

      const item = items[i]!;
      const index = i;
      results.push(this.run(() => fn(item, index), signal));
    }

    return Promise.allSettled(results);
  }

  private drain(): void {
    while (this._active < this._limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      waiter.resolve();
    }
  }
}

export class ProviderConcurrencyRegistry {
  private readonly pools = new Map<string, ConcurrencyPool>();
  private readonly defaults: Record<string, number>;

  constructor(defaults?: Record<string, number>) {
    this.defaults = defaults ?? {};
  }

  forProvider(provider: string): ConcurrencyPool {
    const key = provider.toLowerCase();
    let pool = this.pools.get(key);
    if (!pool) {
      const limit =
        this.defaults[key] ?? DEFAULT_UNKNOWN_PROVIDER_LIMIT;
      pool = new ConcurrencyPool(limit);
      this.pools.set(key, pool);
    }
    return pool;
  }

  setLimit(provider: string, limit: number): void {
    const key = provider.toLowerCase();
    const pool = this.pools.get(key);
    if (pool) {
      pool.limit = limit;
    } else {
      this.defaults[key] = limit;
    }
  }

  snapshot(): Record<string, { active: number; waiting: number; limit: number }> {
    const result: Record<string, { active: number; waiting: number; limit: number }> = {};
    for (const [key, pool] of this.pools) {
      result[key] = { active: pool.active, waiting: pool.waiting, limit: pool.limit };
    }
    return result;
  }
}
