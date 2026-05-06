/**
 * Bounded-concurrency primitives for rate-limiting provider calls.
 *
 * Two classes:
 * - `ConcurrencyPool`: generic bounded-concurrency executor (FIFO slot queue)
 * - `ProviderConcurrencyRegistry`: lazily creates per-provider pools with
 *   configurable limits, for use with `AiClient`
 */
export declare class ConcurrencyPool {
    private _active;
    private readonly queue;
    private _limit;
    constructor(limit: number);
    get active(): number;
    get waiting(): number;
    get limit(): number;
    set limit(value: number);
    /**
     * Acquire a concurrency slot. Returns a release function.
     * Use for long-lived operations (streams) where you need manual control.
     */
    acquire(signal?: AbortSignal): Promise<() => void>;
    /**
     * Wait for a slot, execute fn, release on settle.
     * Rejects immediately with AbortError if signal is already aborted or fires while waiting.
     */
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    /**
     * Bounded-concurrency map with allSettled semantics.
     * One failure doesn't abort the rest. On signal abort, in-flight items
     * finish but no new items start.
     */
    map<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>, opts?: {
        signal?: AbortSignal;
    }): Promise<PromiseSettledResult<R>[]>;
    private drain;
}
export declare class ProviderConcurrencyRegistry {
    private readonly pools;
    private readonly defaults;
    constructor(defaults?: Record<string, number>);
    forProvider(provider: string): ConcurrencyPool;
    setLimit(provider: string, limit: number): void;
    snapshot(): Record<string, {
        active: number;
        waiting: number;
        limit: number;
    }>;
}
//# sourceMappingURL=concurrency.d.ts.map