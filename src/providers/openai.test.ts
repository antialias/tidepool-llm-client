import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";

describe("OpenAIProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the configured base URL override for non-force-real requests", async () => {
    const baseUrlOverride = vi.fn().mockResolvedValue("http://mock-openai.test/v1");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "chatcmpl_test",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"ok\":true}" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider({
      name: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-test",
      baseUrlOverride,
    });

    await provider.call({
      prompt: "Return JSON",
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      model: "gpt-test",
    });

    expect(baseUrlOverride).toHaveBeenCalledWith({
      provider: "openai",
      endpoint: "/chat/completions",
      model: "gpt-test",
      forceReal: undefined,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://mock-openai.test/v1/chat/completions");
  });

  it("bypasses the base URL override when forceReal is set", async () => {
    const baseUrlOverride = vi.fn().mockResolvedValue("http://mock-openai.test/v1");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "chatcmpl_test",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"ok\":true}" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider({
      name: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-test",
      baseUrlOverride,
    });

    await provider.call({
      prompt: "Return JSON",
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      model: "gpt-test",
      forceReal: true,
    });

    expect(baseUrlOverride).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });
});
