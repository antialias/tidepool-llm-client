import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAIResponsesProvider } from "./openai-responses.js";

describe("OpenAIResponsesProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the configured base URL override for Responses API streams", async () => {
    const baseUrlOverride = vi.fn().mockResolvedValue("http://mock-openai.test/v1");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response([
      "event: response.created",
      "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_test\"}}",
      "",
      "event: response.output_text.delta",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"ok\\\":true}\",\"output_index\":0}",
      "",
      "event: response.completed",
      "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_test\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"{\\\"ok\\\":true}\"}]}],\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}",
      "",
    ].join("\n"), {
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIResponsesProvider({
      name: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-test",
      baseUrlOverride,
    });

    const events = [];
    for await (const event of provider.stream({
      prompt: "Return JSON",
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      model: "gpt-test",
      timeoutMs: 30_000,
    }, z.object({ ok: z.boolean() }))) {
      events.push(event);
    }

    expect(baseUrlOverride).toHaveBeenCalledWith({
      provider: "openai",
      endpoint: "/responses",
      model: "gpt-test",
      forceReal: undefined,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://mock-openai.test/v1/responses");
    expect(events.at(-1)).toMatchObject({ type: "complete", data: { ok: true } });
  });

  it("bypasses the base URL override when forceReal is set", async () => {
    const baseUrlOverride = vi.fn().mockResolvedValue("http://mock-openai.test/v1");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response([
      "event: response.created",
      "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_test\"}}",
      "",
      "event: response.completed",
      "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_test\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"{\\\"ok\\\":true}\"}]}],\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}",
      "",
    ].join("\n"), {
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIResponsesProvider({
      name: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-test",
      baseUrlOverride,
    });

    for await (const _event of provider.stream({
      prompt: "Return JSON",
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      model: "gpt-test",
      timeoutMs: 30_000,
      forceReal: true,
    }, z.object({ ok: z.boolean() }))) {
      // Drain stream.
    }

    expect(baseUrlOverride).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/responses");
  });
});
