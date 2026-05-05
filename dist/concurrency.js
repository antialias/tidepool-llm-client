/**
 * Bounded-concurrency primitives for rate-limiting provider calls.
 *
 * Two classes:
 * - `ConcurrencyPool`: generic bounded-concurrency executor (FIFO slot queue)
 * - `ProviderConcurrencyRegistry`: lazily creates per-provider pools with
 *   configurable limits, for use with `AiClient`
 */
const DEFAULT_UNKNOWN_PROVIDER_LIMIT = 3;
export class ConcurrencyPool {
    constructor(limit) {
        this._active = 0;
        this.queue = [];
        if (limit < 1)
            throw new RangeError("ConcurrencyPool limit must be >= 1");
        this._limit = limit;
    }
    get active() {
        return this._active;
    }
    get waiting() {
        return this.queue.length;
    }
    get limit() {
        return this._limit;
    }
    set limit(value) {
        if (value < 1)
            throw new RangeError("ConcurrencyPool limit must be >= 1");
        this._limit = value;
        this.drain();
    }
    /**
     * Acquire a concurrency slot. Returns a release function.
     * Use for long-lived operations (streams) where you need manual control.
     */
    async acquire(signal) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        if (this._active < this._limit) {
            this._active++;
            let released = false;
            return () => {
                if (released)
                    return;
                released = true;
                this._active--;
                this.drain();
            };
        }
        return new Promise((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    cleanup();
                    this._active++;
                    let released = false;
                    resolve(() => {
                        if (released)
                            return;
                        released = true;
                        this._active--;
                        this.drain();
                    });
                },
                reject: (reason) => {
                    cleanup();
                    reject(reason);
                },
            };
            const onAbort = () => {
                const idx = this.queue.indexOf(waiter);
                if (idx !== -1)
                    this.queue.splice(idx, 1);
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
    async run(fn, signal) {
        const release = await this.acquire(signal);
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
    /**
     * Bounded-concurrency map with allSettled semantics.
     * One failure doesn't abort the rest. On signal abort, in-flight items
     * finish but no new items start.
     */
    async map(items, fn, opts) {
        const signal = opts?.signal;
        const results = [];
        for (let i = 0; i < items.length; i++) {
            if (signal?.aborted) {
                // Fill remaining slots with rejection
                for (let j = i; j < items.length; j++) {
                    results.push(Promise.reject(new DOMException("Aborted", "AbortError")));
                }
                break;
            }
            const item = items[i];
            const index = i;
            results.push(this.run(() => fn(item, index), signal));
        }
        return Promise.allSettled(results);
    }
    drain() {
        while (this._active < this._limit && this.queue.length > 0) {
            const waiter = this.queue.shift();
            waiter.resolve();
        }
    }
}
export class ProviderConcurrencyRegistry {
    constructor(defaults) {
        this.pools = new Map();
        this.defaults = defaults ?? {};
    }
    forProvider(provider) {
        const key = provider.toLowerCase();
        let pool = this.pools.get(key);
        if (!pool) {
            const limit = this.defaults[key] ?? DEFAULT_UNKNOWN_PROVIDER_LIMIT;
            pool = new ConcurrencyPool(limit);
            this.pools.set(key, pool);
        }
        return pool;
    }
    setLimit(provider, limit) {
        const key = provider.toLowerCase();
        const pool = this.pools.get(key);
        if (pool) {
            pool.limit = limit;
        }
        else {
            this.defaults[key] = limit;
        }
    }
    snapshot() {
        const result = {};
        for (const [key, pool] of this.pools) {
            result[key] = { active: pool.active, waiting: pool.waiting, limit: pool.limit };
        }
        return result;
    }
}
