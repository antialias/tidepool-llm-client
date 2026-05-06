import { describe, it, expect } from "vitest";
import { ConcurrencyPool, ProviderConcurrencyRegistry } from "./concurrency.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ConcurrencyPool", () => {
  it("respects concurrency limit", async () => {
    const pool = new ConcurrencyPool(2);
    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    const r1 = pool.run(() => d1.promise);
    const r2 = pool.run(() => d2.promise);
    const r3 = pool.run(() => d3.promise);

    // Only 2 should be active, 1 waiting
    expect(pool.active).toBe(2);
    expect(pool.waiting).toBe(1);

    // Complete first, third should start
    d1.resolve();
    await r1;
    // Allow microtask to drain
    await Promise.resolve();
    expect(pool.active).toBe(2);
    expect(pool.waiting).toBe(0);

    d2.resolve();
    d3.resolve();
    await Promise.all([r2, r3]);
    expect(pool.active).toBe(0);
  });

  it("releases slot on rejection", async () => {
    const pool = new ConcurrencyPool(1);
    const d1 = deferred();
    const d2 = deferred<string>();

    const r1 = pool.run(() => d1.promise);
    const r2 = pool.run(() => d2.promise);

    expect(pool.active).toBe(1);
    expect(pool.waiting).toBe(1);

    d1.reject(new Error("boom"));
    await expect(r1).rejects.toThrow("boom");
    await Promise.resolve();
    expect(pool.active).toBe(1);
    expect(pool.waiting).toBe(0);

    d2.resolve("ok");
    await expect(r2).resolves.toBe("ok");
  });

  it("rejects immediately when signal is already aborted", async () => {
    const pool = new ConcurrencyPool(1);
    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.run(() => Promise.resolve("nope"), controller.signal),
    ).rejects.toThrow("Aborted");
  });

  it("rejects waiting items on signal abort", async () => {
    const pool = new ConcurrencyPool(1);
    const controller = new AbortController();
    const d1 = deferred();

    const r1 = pool.run(() => d1.promise);
    const r2 = pool.run(() => Promise.resolve("second"), controller.signal);

    expect(pool.waiting).toBe(1);
    controller.abort();

    await expect(r2).rejects.toThrow("Aborted");
    expect(pool.waiting).toBe(0);

    d1.resolve();
    await r1;
  });

  it("acquire returns release function", async () => {
    const pool = new ConcurrencyPool(1);
    const release = await pool.acquire();
    expect(pool.active).toBe(1);

    // Second acquire should wait
    const d = deferred<() => void>();
    const acquirePromise = pool.acquire().then((r) => {
      d.resolve(r);
      return r;
    });
    expect(pool.waiting).toBe(1);

    release();
    // drain() immediately gives the slot to the next waiter
    const release2 = await acquirePromise;
    expect(pool.active).toBe(1);
    release2();
    expect(pool.active).toBe(0);
  });

  it("double-release is safe", async () => {
    const pool = new ConcurrencyPool(1);
    const release = await pool.acquire();
    release();
    release(); // should not throw or underflow
    expect(pool.active).toBe(0);
  });

  describe("map", () => {
    it("returns all results with allSettled semantics", async () => {
      const pool = new ConcurrencyPool(2);
      const results = await pool.map(
        [1, 2, 3],
        async (item) => {
          if (item === 2) throw new Error("fail");
          return item * 10;
        },
      );

      expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
      expect(results[1]).toMatchObject({ status: "rejected" });
      expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
    });

    it("stops starting new items on signal abort", async () => {
      const pool = new ConcurrencyPool(1);
      const controller = new AbortController();
      const d1 = deferred<number>();
      let item2Started = false;

      const resultPromise = pool.map(
        [1, 2, 3],
        async (item) => {
          if (item === 1) {
            controller.abort();
            return await d1.promise;
          }
          item2Started = true;
          return item;
        },
        { signal: controller.signal },
      );

      d1.resolve(1);
      const results = await resultPromise;

      expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
      // Items 2 and 3 rejected because signal was aborted before they started
      expect(results[1]).toMatchObject({ status: "rejected" });
      expect(results[2]).toMatchObject({ status: "rejected" });
      expect(item2Started).toBe(false);
    });

    it("respects concurrency limit during map", async () => {
      const pool = new ConcurrencyPool(2);
      let maxConcurrent = 0;
      let current = 0;

      await pool.map([1, 2, 3, 4, 5], async () => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 10));
        current--;
      });

      expect(maxConcurrent).toBe(2);
    });
  });

  it("limit setter drains waiters", async () => {
    const pool = new ConcurrencyPool(1);
    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    pool.run(() => d1.promise);
    pool.run(() => d2.promise);
    pool.run(() => d3.promise);

    expect(pool.active).toBe(1);
    expect(pool.waiting).toBe(2);

    // Increase limit — should drain one more waiter
    pool.limit = 2;
    await Promise.resolve();
    expect(pool.active).toBe(2);
    expect(pool.waiting).toBe(1);

    d1.resolve();
    d2.resolve();
    d3.resolve();
  });

  it("throws on invalid limit", () => {
    expect(() => new ConcurrencyPool(0)).toThrow("limit must be >= 1");
    const pool = new ConcurrencyPool(1);
    expect(() => { pool.limit = 0; }).toThrow("limit must be >= 1");
  });
});

describe("ProviderConcurrencyRegistry", () => {
  it("creates pools lazily with configured defaults", () => {
    const registry = new ProviderConcurrencyRegistry({ openai: 5, gemini: 4 });
    const openai = registry.forProvider("openai");
    expect(openai.limit).toBe(5);
    expect(registry.forProvider("gemini").limit).toBe(4);
  });

  it("returns same pool instance on repeated calls", () => {
    const registry = new ProviderConcurrencyRegistry({ openai: 5 });
    const a = registry.forProvider("openai");
    const b = registry.forProvider("openai");
    expect(a).toBe(b);
  });

  it("uses default limit of 3 for unknown providers", () => {
    const registry = new ProviderConcurrencyRegistry({ openai: 5 });
    const unknown = registry.forProvider("mystery-ai");
    expect(unknown.limit).toBe(3);
  });

  it("normalizes provider names to lowercase", () => {
    const registry = new ProviderConcurrencyRegistry({ openai: 5 });
    expect(registry.forProvider("OpenAI")).toBe(registry.forProvider("openai"));
  });

  it("setLimit updates existing pool", () => {
    const registry = new ProviderConcurrencyRegistry({ openai: 5 });
    const pool = registry.forProvider("openai");
    registry.setLimit("openai", 10);
    expect(pool.limit).toBe(10);
  });

  it("setLimit sets default for not-yet-created pool", () => {
    const registry = new ProviderConcurrencyRegistry({});
    registry.setLimit("newProvider", 7);
    expect(registry.forProvider("newprovider").limit).toBe(7);
  });

  it("snapshot returns state of all active pools", async () => {
    const registry = new ProviderConcurrencyRegistry({ openai: 2 });
    const pool = registry.forProvider("openai");
    const release = await pool.acquire();

    const snap = registry.snapshot();
    expect(snap).toEqual({
      openai: { active: 1, waiting: 0, limit: 2 },
    });

    release();
  });
});
