import { describe, expect, it, vi } from "vitest";
import {
  buildFeedbackPrompt,
  executeWithRetry,
  getRetryDelay,
  isRetryableError,
} from "./retry.js";
import {
  LLMApiError,
  LLMContentFilterError,
  LLMJsonParseError,
  LLMTruncationError,
  LLMValidationError,
} from "./types.js";

describe("retry helpers", () => {
  it("classifies retryable and terminal errors", () => {
    expect(isRetryableError(new LLMApiError("openai", 429, "rate"))).toBe(true);
    expect(isRetryableError(new LLMApiError("openai", 500, "server"))).toBe(true);
    expect(isRetryableError(new LLMApiError("openai", 400, "bad"))).toBe(false);
    expect(isRetryableError(new LLMContentFilterError("openai"))).toBe(false);
    expect(isRetryableError(new LLMTruncationError("openai", {}))).toBe(false);
    expect(isRetryableError(new LLMJsonParseError("nope", "bad json"))).toBe(true);
  });

  it("uses retry-after before exponential backoff", () => {
    expect(getRetryDelay(new LLMApiError("openai", 429, "rate", 5000), 1, 1000, 60_000)).toBe(5000);
  });

  it("feeds validation feedback into the retry attempt", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ count: "one" })
      .mockResolvedValueOnce({ count: 1 });
    const validate = vi.fn((value: { count: unknown }) =>
      typeof value.count === "number"
        ? null
        : { field: "count", error: "Expected number", received: value.count },
    );

    const result = await executeWithRetry(fn, validate, {
      maxRetries: 1,
      baseDelayMs: 1,
    });

    expect(result.result).toEqual({ count: 1 });
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenLastCalledWith({
      field: "count",
      error: "Expected number",
      received: "one",
    });
  });

  it("throws validation error after retries are exhausted", async () => {
    await expect(
      executeWithRetry(
        vi.fn().mockResolvedValue({ count: "one" }),
        () => ({ field: "count", error: "Expected number" }),
        { maxRetries: 0, baseDelayMs: 1 },
      ),
    ).rejects.toThrow(LLMValidationError);
  });

  it("formats validation feedback prompts", () => {
    expect(buildFeedbackPrompt({
      field: "status",
      error: "Invalid enum value",
      validOptions: ["draft", "published"],
    })).toContain("Valid options: draft, published");
  });
});
