import { describe, expect, it } from "vitest";
import { AiError, isAiError, toAiError } from "./errors.js";
import {
  LLMApiError,
  LLMContentFilterError,
  LLMJsonParseError,
  LLMNetworkError,
  LLMTimeoutError,
  LLMTruncationError,
  LLMValidationError,
  ProviderNotConfiguredError,
} from "./types.js";

describe("AiError", () => {
  it("narrows by kind", () => {
    const error: unknown = new AiError({
      kind: "provider_rate_limited",
      message: "slow down",
    });

    expect(isAiError(error)).toBe(true);
    expect(isAiError(error, "provider_rate_limited")).toBe(true);
    expect(isAiError(error, "provider_unavailable")).toBe(false);
  });

  it("maps provider and configuration errors to stable kinds", () => {
    expect(toAiError(new ProviderNotConfiguredError("gemini")).kind).toBe(
      "provider_not_configured",
    );
    expect(toAiError(new LLMApiError("openai", 429, "rate limited")).kind).toBe(
      "provider_rate_limited",
    );
    expect(toAiError(new LLMApiError("openai", 503, "down")).kind).toBe(
      "provider_unavailable",
    );
    expect(toAiError(new LLMApiError("openai", 400, "bad")).kind).toBe(
      "invalid_request",
    );
  });

  it("maps validation, provider response, refusal, timeout, and network errors", () => {
    expect(
      toAiError(
        new LLMValidationError({
          field: "root",
          error: "bad shape",
        }),
      ).kind,
    ).toBe("schema_validation_failed");
    expect(toAiError(new LLMJsonParseError("nope", "Unexpected")).kind).toBe(
      "provider_bad_response",
    );
    expect(toAiError(new LLMContentFilterError("openai")).kind).toBe(
      "provider_refused",
    );
    expect(toAiError(new LLMTruncationError("openai", {})).kind).toBe(
      "context_too_large",
    );
    expect(toAiError(new LLMTimeoutError("openai", 10)).kind).toBe("timeout");
    expect(toAiError(new LLMNetworkError("openai")).kind).toBe(
      "provider_unavailable",
    );
  });

  it("enriches existing AiErrors without losing the original kind", () => {
    const error = toAiError(
      new AiError({
        kind: "timeout",
        message: "timed out",
      }),
      {
        intent: "scout",
        callSite: "pipeline.scout",
        provider: "openai",
        model: "gpt-test",
      },
    );

    expect(error).toMatchObject({
      kind: "timeout",
      intent: "scout",
      callSite: "pipeline.scout",
      provider: "openai",
      model: "gpt-test",
    });
  });
});
