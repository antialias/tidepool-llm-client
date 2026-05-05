import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BaseProvider } from "./base.js";
import type { ProviderConfig, ProviderRequest, ProviderResponse } from "../types.js";

class TestProvider extends BaseProvider {
  async call(_request: ProviderRequest): Promise<ProviderResponse> {
    throw new Error("Not implemented");
  }

  buildTestPrompt(request: ProviderRequest): string {
    return this.buildPrompt(request);
  }

  parseTestJson(content: string): unknown {
    return this.parseJsonResponse(content);
  }
}

const config: ProviderConfig = {
  name: "test",
  apiKey: "test-key",
  baseUrl: "https://example.test",
  defaultModel: "test-model",
};

describe("BaseProvider", () => {
  it("includes schema descriptions and retry feedback in prompts", () => {
    const provider = new TestProvider(config);
    const jsonSchema = z.toJSONSchema(z.object({
      sentiment: z.string().describe("Detected sentiment"),
      confidence: z.number().describe("Confidence score"),
    }).describe("Sentiment result")) as Record<string, unknown>;

    const prompt = provider.buildTestPrompt({
      prompt: "Analyze this text",
      jsonSchema,
      model: "test-model",
      validationFeedback: {
        field: "confidence",
        error: "Expected number",
        received: "high",
      },
    });

    expect(prompt).toContain("Analyze this text");
    expect(prompt).toContain("Sentiment result");
    expect(prompt).toContain("Detected sentiment");
    expect(prompt).toContain("PREVIOUS ATTEMPT HAD VALIDATION ERROR");
    expect(prompt).toContain("confidence");
  });

  it("parses plain JSON and JSON markdown blocks", () => {
    const provider = new TestProvider(config);

    expect(provider.parseTestJson("{\"ok\":true}")).toEqual({ ok: true });
    expect(provider.parseTestJson("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });
});
