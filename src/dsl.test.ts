import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createLlmClient, type AiProviderFactory } from "./dsl.js";
import { AiError, isAiError } from "./errors.js";
import { defineIntentRegistry } from "./intent-registry.js";
import { defineAiPlugin } from "./plugins.js";
import type {
  AiProviderEmbeddingRequest,
  AiProviderEmbeddingResponse,
  AiProviderImageEditRequest,
  AiProviderImageEditResponse,
  AiProviderStreamObjectRequest,
} from "./operations.js";
import type {
  LLMProvider,
  LLMUsageEvent,
  ProviderRequest,
  ProviderResponse,
  StreamEvent,
} from "./types.js";
import { LLMApiError } from "./types.js";

const TestRegistry = defineIntentRegistry({
  extractObject: {
    kind: "text-object",
    defaultModel: "primary/object-model",
    requiredCapabilities: ["jsonSchema", "text"],
  },
  longContextObject: {
    kind: "text-object",
    defaultModel: "primary/object-model",
    requiredCapabilities: ["jsonSchema", "longContext"],
  },
  // A misconfigured intent: declares text-object as the operation but asks
  // for `streaming`, which only text-stream provides. The DSL must still
  // catch this kind of operation/capability mismatch.
  streamingTextObject: {
    kind: "text-object",
    defaultModel: "primary/object-model",
    requiredCapabilities: ["streaming"],
  },
  writeText: {
    kind: "text",
    defaultModel: "primary/text-model",
  },
  streamObject: {
    kind: "text-stream",
    defaultModel: "primary/stream-model",
    requiredCapabilities: ["streaming"],
  },
  embedText: {
    kind: "embedding",
    defaultModel: "primary/embed-model",
    requiredCapabilities: ["embeddings"],
  },
  editImage: {
    kind: "image-edit",
    defaultModel: "primary/image-model",
    requiredCapabilities: ["imageEdit", "references"],
  },
});

type FakeStep = ProviderResponse | Error;

class FakeProvider implements LLMProvider {
  readonly calls: ProviderRequest[] = [];
  readonly embeddingCalls: AiProviderEmbeddingRequest[] = [];
  readonly streamCalls: AiProviderStreamObjectRequest[] = [];
  readonly imageEditCalls: AiProviderImageEditRequest[] = [];

  constructor(
    readonly name: string,
    private readonly steps: FakeStep[],
  ) {}

  async call(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    const next = this.steps.shift();
    if (!next) {
      throw new Error(`No fake response queued for ${this.name}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }

  async embed(
    request: AiProviderEmbeddingRequest,
  ): Promise<AiProviderEmbeddingResponse> {
    this.embeddingCalls.push(request);
    return {
      embeddings: [new Float32Array([0.1, 0.2])],
      usage: {
        promptTokens: 3,
        totalTokens: 3,
      },
      model: request.model,
    };
  }

  async imageEdit(
    request: AiProviderImageEditRequest,
  ): Promise<AiProviderImageEditResponse> {
    this.imageEditCalls.push(request);
    return {
      images: ["data:image/png;base64,AAAA"],
      usage: {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        imageOutputTokens: 200,
      },
      model: request.model,
    };
  }

  async *streamObject<TSchema extends z.ZodType>(
    request: AiProviderStreamObjectRequest,
    _schema: TSchema,
  ): AsyncGenerator<StreamEvent<z.infer<TSchema>>, void, unknown> {
    this.streamCalls.push(request);
    const next = this.steps.shift();
    if (!next) {
      throw new Error(`No fake stream response queued for ${this.name}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    yield { type: "started", responseId: "stream_fake" };
    yield {
      type: "output_delta",
      text: next.rawContent,
      outputIndex: 0,
    };
    yield {
      type: "complete",
      data: next.content as z.infer<TSchema>,
      usage: next.usage,
      rawResponse: next.rawContent,
    };
  }
}

function providerResponse(content: unknown): ProviderResponse {
  return {
    content,
    rawContent: JSON.stringify(content),
    usage: {
      promptTokens: 7,
      completionTokens: 11,
      cachedInputTokens: 2,
      reasoningTokens: 3,
    },
    finishReason: "stop",
    responseId: "resp_fake",
  };
}

function clientWithProviders(
  providers: Record<string, FakeProvider>,
  usageRecorder?: (event: LLMUsageEvent) => void,
) {
  const factory: AiProviderFactory = ({ providerName }) => {
    const provider = providers[providerName];
    if (!provider) {
      throw new Error(`Missing fake provider ${providerName}`);
    }
    return provider;
  };

  return createLlmClient({
    registry: TestRegistry,
    providers: Object.fromEntries(
      Object.keys(providers).map((providerName) => [
        providerName,
        {
          name: providerName,
          apiKey: "fake",
          baseUrl: "https://fake.example/v1",
          defaultModel: `${providerName}-default-model`,
        },
      ]),
    ),
    defaultProvider: "primary",
    providerFactories: Object.fromEntries(
      Object.keys(providers).map((providerName) => [providerName, factory]),
    ),
    usageRecorder,
  });
}

describe("createLlmClient DSL", () => {
  it("returns schema-inferred output from object calls", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ ok: true, count: 2 }),
    ]);
    const client = clientWithProviders({ primary: provider });
    const Schema = z.object({
      ok: z.boolean(),
      count: z.number(),
    });

    const result = await client.intent("extractObject").object({
      prompt: "extract",
      schema: Schema,
    });

    expectTypeOf(result.output).toEqualTypeOf<{
      ok: boolean;
      count: number;
    }>();
    expect(result.output).toEqual({ ok: true, count: 2 });
    expect(result).toMatchObject({
      operation: "text-object",
      provider: "primary",
      model: "object-model",
      intent: "extractObject",
    });
  });

  it("unwraps text output while still using structured provider calls", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ text: "clean text" }),
    ]);
    const client = clientWithProviders({ primary: provider });

    const result = await client.intent("writeText").text({
      messages: [
        { role: "system", content: "Return terse text." },
        { role: "user", content: "Say hello." },
      ],
    });

    expect(result.output).toBe("clean text");
    expect(provider.calls[0]?.prompt).toContain("### system");
    expect(provider.calls[0]?.prompt).toContain("### user");
  });

  it("returns a typed stream wrapper", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    const provider = new FakeProvider("primary", [
      providerResponse({ value: "from stream" }),
    ]);
    const client = clientWithProviders({ primary: provider }, (event) => {
      usageEvents.push(event);
    });
    const Schema = z.object({ value: z.string() });

    const result = await client.intent("streamObject").streamObject({
      prompt: "stream",
      schema: Schema,
    });

    const events = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    expectTypeOf(result.stream).toEqualTypeOf<
      AsyncGenerator<
        import("./types.js").StreamEvent<{ value: string }>,
        void,
        unknown
      >
    >();
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "output_delta",
      "complete",
    ]);
    expect(events[2]).toMatchObject({
      type: "complete",
      data: { value: "from stream" },
    });
    expect(provider.streamCalls[0]).toMatchObject({
      model: "stream-model",
      prompt: "stream",
    });
    expect(provider.calls).toHaveLength(0);
    expect(usageEvents).toMatchObject([
      {
        operation: "llm_stream",
        status: "success",
        provider: "primary",
        model: "stream-model",
        endpoint: "/responses",
        promptTokens: 7,
        completionTokens: 11,
      },
    ]);
  });

  it("preserves embedding result shape", async () => {
    const provider = new FakeProvider("primary", []);
    const client = clientWithProviders({ primary: provider });

    const result = await client.intent("embedText").embed({
      input: ["one", "two"],
      dimensions: 2,
    });

    expect(result.operation).toBe("embedding");
    expect(result.embeddings[0]).toBeInstanceOf(Float32Array);
    expect(provider.embeddingCalls[0]).toMatchObject({
      input: ["one", "two"],
      model: "embed-model",
      dimensions: 2,
    });
  });

  it("returns images from imageEdit calls", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    const provider = new FakeProvider("primary", []);
    const client = clientWithProviders({ primary: provider }, (event) => {
      usageEvents.push(event);
    });

    const result = await client.intent("editImage").imageEdit({
      prompt: "a cat in a hat",
      referenceImages: ["data:image/png;base64,REF1"],
      size: "1024x1024",
      quality: "high",
    });

    expect(result.operation).toBe("image-edit");
    expect(result.images).toEqual(["data:image/png;base64,AAAA"]);
    expect(result.provider).toBe("primary");
    expect(result.model).toBe("image-model");
    expect(result.intent).toBe("editImage");
    expect(provider.imageEditCalls[0]).toMatchObject({
      referenceImages: ["data:image/png;base64,REF1"],
      model: "image-model",
      size: "1024x1024",
      quality: "high",
    });
    expect(provider.imageEditCalls[0]?.prompt).toContain("a cat in a hat");
    expect(usageEvents).toMatchObject([
      {
        operation: "image_edit",
        status: "success",
        provider: "primary",
        model: "image-model",
        endpoint: "/images/edits",
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
      },
    ]);
  });

  it("throws model_capability_mismatch when provider lacks imageEdit", async () => {
    const provider = new FakeProvider("primary", []);
    const factory: AiProviderFactory = () => ({
      name: "primary",
      call: provider.call.bind(provider),
    });
    const client = createLlmClient({
      registry: TestRegistry,
      providers: {
        primary: {
          name: "primary",
          apiKey: "fake",
          baseUrl: "https://fake.example/v1",
          defaultModel: "image-model",
        },
      },
      defaultProvider: "primary",
      providerFactories: { primary: factory },
    });

    await expect(
      client.intent("editImage").imageEdit({
        prompt: "generate",
        referenceImages: ["data:image/png;base64,REF"],
      }),
    ).rejects.toThrow(/does not expose image editing/);
  });

  it("rejects imageEdit when intent kind is mismatched", async () => {
    const provider = new FakeProvider("primary", []);
    const client = clientWithProviders({ primary: provider });

    await expect(
      client.intent("extractObject").imageEdit({
        prompt: "generate",
        referenceImages: ["data:image/png;base64,REF"],
      }),
    ).rejects.toThrow(/is for 'text-object', not 'image-edit'/);
  });

  it("derives child scopes without mutating the parent client", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ text: "child" }),
      providerResponse({ text: "parent" }),
    ]);
    const client = clientWithProviders({ primary: provider });
    const child = client
      .scope({ usageContext: { requestId: "child" } })
      .intent("writeText")
      .model("primary/child-model")
      .callSite("test.child");

    const childResult = await child.text({ prompt: "child" });
    const parentResult = await client.intent("writeText").text({
      prompt: "parent",
    });

    expect(childResult).toMatchObject({
      model: "child-model",
      callSite: "test.child",
      usageContext: { requestId: "child" },
    });
    expect(parentResult).toMatchObject({
      model: "text-model",
      callSite: undefined,
      usageContext: undefined,
    });
  });

  it("supports .with() as a scope alias and forwards temperature", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ text: "warm" }),
    ]);
    const client = clientWithProviders({ primary: provider });

    const result = await client
      .with({ callSite: "test.with" })
      .intent("writeText")
      .text({
        prompt: "temperature please",
        temperature: 0.2,
      });

    expect(result.callSite).toBe("test.with");
    expect(provider.calls[0]).toMatchObject({
      temperature: 0.2,
    });
  });

  it("runs middleware in order and preserves result typing", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ ok: true }),
    ]);
    const events: string[] = [];
    const registry = TestRegistry;
    const plugin = defineAiPlugin<typeof registry>({
      name: "trace",
      middleware: [
        async (_context, next) => {
          events.push("outer:before");
          const result = await next();
          events.push(`outer:after:${result.operation}`);
          return result;
        },
        async (_context, next) => {
          events.push("inner:before");
          const result = await next();
          events.push(`inner:after:${result.operation}`);
          return result;
        },
      ],
    });
    const client = createLlmClient({
      registry,
      providers: {
        primary: {
          name: "primary",
          apiKey: "fake",
          baseUrl: "https://fake.example/v1",
          defaultModel: "primary-default-model",
        },
      },
      providerFactories: {
        primary: () => provider,
      },
      plugins: [plugin],
    });

    const result = await client.intent("extractObject").object({
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
    });

    expectTypeOf(result.output).toEqualTypeOf<{ ok: boolean }>();
    expect(events).toEqual([
      "outer:before",
      "inner:before",
      "inner:after:text-object",
      "outer:after:text-object",
    ]);
  });

  it("fires hooks on success, error, retry, and fallback decisions", async () => {
    const primary = new FakeProvider("primary", [
      providerResponse({ ok: "not boolean" }),
      new LLMApiError("primary", 429, "rate limited"),
    ]);
    const backup = new FakeProvider("backup", [
      providerResponse({ ok: true }),
    ]);
    const events: string[] = [];
    const client = createLlmClient({
      registry: TestRegistry,
      providers: {
        primary: {
          name: "primary",
          apiKey: "fake",
          baseUrl: "https://fake.example/v1",
          defaultModel: "primary-default",
        },
        backup: {
          name: "backup",
          apiKey: "fake",
          baseUrl: "https://fake.example/v1",
          defaultModel: "backup-default",
        },
      },
      providerFactories: {
        primary: () => primary,
        backup: () => backup,
      },
      hooks: {
        beforeResolve: () => {
          events.push("beforeResolve");
        },
        beforeProviderCall: () => {
          events.push("beforeProviderCall");
        },
        afterError: (_context, error) => {
          events.push(`afterError:${error.kind}`);
        },
        afterRetry: (_context, error) => {
          events.push(`afterRetry:${error.kind}`);
        },
        afterFallbackDecision: (decision) => {
          events.push(`fallback:${decision.willFallback}`);
        },
        afterSuccess: () => {
          events.push("afterSuccess");
        },
      },
    });

    await client.intent("extractObject").object({
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      retry: {
        attempts: 1,
        on: ["schema_validation_failed"],
      },
      fallbackPolicy: {
        mode: "ordered",
        candidates: ["backup/object-model"],
        on: ["provider_rate_limited"],
      },
    });

    expect(events).toEqual([
      "beforeResolve",
      "beforeProviderCall",
      "afterError:schema_validation_failed",
      "afterRetry:schema_validation_failed",
      "beforeProviderCall",
      "afterError:provider_rate_limited",
      "fallback:true",
      "beforeProviderCall",
      "afterSuccess",
    ]);
  });

  it("does not retry by default", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ ok: "nope" }),
      providerResponse({ ok: true }),
    ]);
    const client = clientWithProviders({ primary: provider });

    await expect(
      client.intent("extractObject").object({
        prompt: "x",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toMatchObject({ kind: "schema_validation_failed" });
    expect(provider.calls).toHaveLength(1);
  });

  it("retries the same provider/model with validation feedback when configured", async () => {
    const usageEvents: LLMUsageEvent[] = [];
    const provider = new FakeProvider("primary", [
      providerResponse({ ok: "nope" }),
      providerResponse({ ok: true }),
    ]);
    const client = clientWithProviders({ primary: provider }, (event) => {
      usageEvents.push(event);
    });

    const result = await client.intent("extractObject").object({
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      retry: {
        attempts: 1,
        on: ["schema_validation_failed"],
      },
    });

    expect(result.output).toEqual({ ok: true });
    expect(result.attempts.map((attempt) => attempt.model)).toEqual([
      "object-model",
      "object-model",
    ]);
    expect(provider.calls[1]?.validationFeedback).toMatchObject({
      field: "ok",
    });
    expect(new Set(usageEvents.map((event) => event.retryGroupId)).size).toBe(1);
  });

  it("keeps fallback disabled unless explicitly configured", async () => {
    const primary = new FakeProvider("primary", [
      new LLMApiError("primary", 429, "rate limited"),
    ]);
    const backup = new FakeProvider("backup", [
      providerResponse({ ok: true }),
    ]);
    const client = clientWithProviders({ primary, backup });

    await expect(
      client.intent("extractObject").object({
        prompt: "x",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toMatchObject({ kind: "provider_rate_limited" });
    expect(backup.calls).toHaveLength(0);
  });

  it("runs explicit fallback only for allowed provider errors", async () => {
    const primary = new FakeProvider("primary", [
      new LLMApiError("primary", 429, "rate limited"),
    ]);
    const backup = new FakeProvider("backup", [
      providerResponse({ ok: true }),
    ]);
    const client = clientWithProviders({ primary, backup });

    const result = await client.intent("extractObject").object({
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      fallbackPolicy: {
        mode: "ordered",
        candidates: ["backup/object-model"],
        on: ["provider_rate_limited"],
      },
    });

    expect(result.output).toEqual({ ok: true });
    expect(result.provider).toBe("backup");
    expect(result.attempts.map((attempt) => attempt.provider)).toEqual([
      "primary",
      "backup",
    ]);
  });

  it("never falls back for validation or configuration errors", async () => {
    const primary = new FakeProvider("primary", [
      providerResponse({ ok: "not boolean" }),
    ]);
    const backup = new FakeProvider("backup", [
      providerResponse({ ok: true }),
    ]);
    const client = clientWithProviders({ primary, backup });

    const promise = client.intent("extractObject").object({
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      fallbackPolicy: {
        mode: "ordered",
        candidates: ["backup/object-model"],
        on: ["schema_validation_failed", "provider_not_configured"],
      },
    });

    await expect(promise).rejects.toSatisfy((error: unknown) =>
      isAiError(error, "schema_validation_failed"),
    );
    expect(backup.calls).toHaveLength(0);
  });

  it("throws AiError for model/provider setup problems", async () => {
    const client = createLlmClient({
      registry: TestRegistry,
      providers: {},
    });

    await expect(
      client.model("missing/model").text({ prompt: "x" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiError && error.kind === "provider_not_configured",
    );
  });

  it("allows model-only capabilities (e.g. longContext) on operation-kind-matching intents", async () => {
    const provider = new FakeProvider("primary", [
      providerResponse({ ok: true }),
    ]);
    const client = clientWithProviders({ primary: provider });
    const Schema = z.object({ ok: z.boolean() });

    // longContext is a model capability, not an operation capability — it
    // must not be flagged as an "unsupported operation capability" on a
    // text-object intent that the operation kind otherwise satisfies.
    // Model-capability validation is the resolver's job, not the DSL's.
    const result = await client.intent("longContextObject").object({
      prompt: "extract",
      schema: Schema,
    });

    expect(result.output).toEqual({ ok: true });
  });

  it("still rejects operation-level capabilities the chosen kind cannot supply", async () => {
    const provider = new FakeProvider("primary", []);
    const client = clientWithProviders({ primary: provider });
    const Schema = z.object({ ok: z.boolean() });

    // streamingTextObject declares kind=text-object but requires `streaming`
    // — only text-stream supplies that. The DSL must surface this as a
    // model_capability_mismatch.
    await expect(
      client.intent("streamingTextObject").object({
        prompt: "extract",
        schema: Schema,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiError &&
        error.kind === "model_capability_mismatch" &&
        error.message.includes("streaming"),
    );
  });

  describe("concurrency integration", () => {
    it("serializes concurrent object() calls when pool limit is 1", async () => {
      const { ProviderConcurrencyRegistry } = await import("./concurrency.js");
      const registry = new ProviderConcurrencyRegistry({ primary: 1 });

      let concurrentCalls = 0;
      let maxConcurrent = 0;

      const provider = new FakeProvider("primary", [
        providerResponse({ a: 1 }),
        providerResponse({ b: 2 }),
      ]);
      const originalCall = provider.call.bind(provider);
      provider.call = async (req) => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise((r) => setTimeout(r, 20));
        const result = await originalCall(req);
        concurrentCalls--;
        return result;
      };

      const factory: AiProviderFactory = () => provider;
      const client = createLlmClient({
        registry: TestRegistry,
        providers: {
          primary: {
            name: "primary",
            apiKey: "fake",
            baseUrl: "https://fake.example/v1",
            defaultModel: "object-model",
          },
        },
        defaultProvider: "primary",
        providerFactories: { primary: factory },
        concurrency: registry,
      });

      const Schema = z.object({}).passthrough();
      const [r1, r2] = await Promise.all([
        client.intent("extractObject").object({ prompt: "a", schema: Schema }),
        client.intent("extractObject").object({ prompt: "b", schema: Schema }),
      ]);

      expect(r1.output).toEqual({ a: 1 });
      expect(r2.output).toEqual({ b: 2 });
      expect(maxConcurrent).toBe(1);
    });

    it("allows full concurrency without registry (backwards compat)", async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      const provider = new FakeProvider("primary", [
        providerResponse({ a: 1 }),
        providerResponse({ b: 2 }),
      ]);
      const originalCall = provider.call.bind(provider);
      provider.call = async (req) => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise((r) => setTimeout(r, 20));
        const result = await originalCall(req);
        concurrentCalls--;
        return result;
      };

      const client = clientWithProviders({ primary: provider });
      const Schema = z.object({}).passthrough();
      await Promise.all([
        client.intent("extractObject").object({ prompt: "a", schema: Schema }),
        client.intent("extractObject").object({ prompt: "b", schema: Schema }),
      ]);

      expect(maxConcurrent).toBe(2);
    });
  });
});
