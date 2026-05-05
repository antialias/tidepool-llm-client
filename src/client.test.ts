import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LLMClient } from "./client.js";
import type { LLMUsageEvent } from "./types.js";

describe("LLMClient usage recorder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records successful structured calls", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "chatcmpl_test",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"ok\":true}" },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
        prompt_tokens_details: { cached_tokens: 1 },
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new LLMClient({
      defaultProvider: "openai",
      defaultMaxRetries: 0,
      providers: {
        openai: {
          name: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-test",
        },
      },
      usageRecorder: (event) => {
        usageEvents.push(event);
      },
    }, {});

    await client.call({
      prompt: "Return JSON",
      schema: z.object({ ok: z.boolean() }),
      usageContext: { callSite: "test" },
    });

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      usageContext: { callSite: "test" },
      operation: "llm_call",
      status: "success",
      provider: "openai",
      model: "gpt-test",
      endpoint: "/chat/completions",
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
      cachedInputTokens: 1,
      reasoningTokens: 1,
    });
  });

  it("records failed structured calls", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "bad request" },
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new LLMClient({
      defaultProvider: "openai",
      defaultMaxRetries: 0,
      providers: {
        openai: {
          name: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-test",
        },
      },
      usageRecorder: (event) => {
        usageEvents.push(event);
      },
    }, {});

    await expect(client.call({
      prompt: "Return JSON",
      schema: z.object({ ok: z.boolean() }),
    })).rejects.toThrow("bad request");

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      operation: "llm_call",
      status: "error",
      httpStatus: 400,
      errorKind: "LLMApiError",
    });
  });

  it("records successful streams", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response([
      "event: response.created",
      "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_test\"}}",
      "",
      "event: response.output_text.delta",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"ok\\\":true}\",\"output_index\":0}",
      "",
      "event: response.completed",
      "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_test\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"{\\\"ok\\\":true}\"}]}],\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"output_tokens_details\":{\"reasoning_tokens\":1}}}}",
      "",
    ].join("\n"), {
      headers: { "Content-Type": "text/event-stream" },
    })));

    const client = new LLMClient({
      defaultProvider: "openai",
      defaultMaxRetries: 0,
      providers: {
        openai: {
          name: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-test",
        },
      },
      usageRecorder: (event) => {
        usageEvents.push(event);
      },
    }, {});

    for await (const _event of client.stream({
      prompt: "Return JSON",
      schema: z.object({ ok: z.boolean() }),
      model: "gpt-test",
    })) {
      // Drain stream.
    }

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      operation: "llm_stream",
      status: "success",
      providerResponseId: "resp_test",
      promptTokens: 2,
      completionTokens: 3,
      reasoningTokens: 1,
    });
  });

  it("records failed streams", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "stream failed" },
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new LLMClient({
      defaultProvider: "openai",
      defaultMaxRetries: 0,
      providers: {
        openai: {
          name: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-test",
        },
      },
      usageRecorder: (event) => {
        usageEvents.push(event);
      },
    }, {});

    const drainStream = async () => {
      for await (const _event of client.stream({
        prompt: "Return JSON",
        schema: z.object({ ok: z.boolean() }),
        model: "gpt-test",
      })) {
        // Drain stream.
      }
    };

    await expect(drainStream()).rejects.toThrow("stream failed");

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      operation: "llm_stream",
      status: "error",
      httpStatus: 500,
      errorKind: "LLMApiError",
    });
  });

  it("records successful embeddings", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2], index: 0 }],
      usage: { prompt_tokens: 4, total_tokens: 4 },
      model: "text-embedding-3-small",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const client = new LLMClient({
      defaultProvider: "openai",
      defaultMaxRetries: 0,
      providers: {
        openai: {
          name: "openai",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-test",
        },
      },
      usageRecorder: (event) => {
        usageEvents.push(event);
      },
    }, {});

    await client.embed({ input: "hello" });

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      operation: "embedding",
      status: "success",
      provider: "openai",
      model: "text-embedding-3-small",
      endpoint: "/embeddings",
      promptTokens: 4,
      totalTokens: 4,
    });
  });
});
