<img src="../logo-small.png" width="64" align="right" />

# Migration Guide

Migrating to `@tidepool/llm-client` from raw provider SDKs. Both paths converge on the same target: `createLlmClient()` with an intent registry.

---

## From raw OpenAI SDK

| OpenAI SDK | `@tidepool/llm-client` |
|---|---|
| `model: "gpt-4.1"` | Intent `defaultModel` or `client.model("openai/gpt-4.1")` |
| `response_format: { type: "json_schema", ... }` | Zod schema passed to `.object({ schema })` |
| Manual retry loop | `retry: { attempts: 2, on: ["schema_validation_failed"] }` |
| `try/catch` on HTTP status codes | `isAiError(e, "provider_rate_limited")` |
| `openai.embeddings.create()` | `client.embed({ input: "..." })` |

**Before:**
```typescript
import OpenAI from "openai";
const openai = new OpenAI();

async function extractSentiment(text: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: `Analyze: "${text}"` }],
        response_format: { type: "json_schema", json_schema: { /* ... */ } },
      });
      return JSON.parse(response.choices[0].message.content!);
    } catch (err: any) {
      if (err.status === 429 && attempt < 2) continue;
      throw err;
    }
  }
}
```

**After:**
```typescript
import { createLlmClient, defineIntentRegistry, loadConfigFromEnv } from "@tidepool/llm-client";
import { z } from "zod";

const registry = defineIntentRegistry({
  sentiment: {
    kind: "text-object",
    defaultModel: "openai/gpt-4.1",
    retry: { attempts: 2, on: ["provider_rate_limited", "schema_validation_failed"] },
  },
});

const ai = createLlmClient({ registry, providers: loadConfigFromEnv().providers });

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

async function extractSentiment(text: string) {
  const result = await ai.intent("sentiment").object({
    prompt: `Analyze: "${text}"`,
    schema: SentimentSchema,
  });
  return result.output; // fully typed
}
```

## From raw Anthropic SDK

The same pattern applies. The client handles Anthropic's `/messages` endpoint internally.

**Before:** `await client.messages.create({ model: "claude-sonnet-4-6", messages: [...] })`
**After:**
```typescript
const result = await ai.model("anthropic/claude-sonnet-4-6").text({
  prompt: "Summarize this document...",
});
const text = result.output; // string
```

For structured output, use `.object()` with a Zod schema.

---

## Step-by-step migration

**1. List call sites.** Find every raw SDK call. Note the model, provider, retry count, and schema.

**2. Define an intent registry.** Group call sites by purpose. Each intent declares its operation kind, default model, and retry/fallback policy.

```typescript
export const registry = defineIntentRegistry({
  scenePlan: {
    kind: "text-object",
    defaultModel: "openai/gpt-4.1",
    retry: { attempts: 2, on: ["schema_validation_failed"] },
  },
  imageCaption: { kind: "text", defaultModel: "anthropic/claude-sonnet-4-6" },
  chapterEmbed: { kind: "embedding", defaultModel: "openai/text-embedding-3-small" },
  illustration: {
    kind: "image-edit",
    defaultModel: "openai/gpt-image-1",
    fallbackPolicy: {
      mode: "ordered",
      candidates: ["openai/dall-e-3"],
      on: ["provider_rate_limited", "provider_unavailable", "timeout"],
    },
  },
});
```

**3. Create the client.**
```typescript
const ai = createLlmClient({ registry, providers: loadConfigFromEnv().providers });
```

**4. Replace call sites.** Use `ai.intent("name")` then the appropriate method: `.object()`, `.text()`, `.streamObject()`, `.embed()`. Access `result.output` instead of `result.data`.

**5. Replace error handling.** Swap `instanceof` checks for `isAiError(err, "kind")`. The `AiError` object exposes `.retryable` and `.userVisible` booleans for branching.

**6. Add a usage recorder** (optional). Pass `usageRecorder` to the client config.

---

## Environment variable changes

None. `loadConfigFromEnv()` reads the same variables in both APIs:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Provider credentials |
| `{PROVIDER}_BASE_URL` | Override provider base URL |
| `{PROVIDER}_MODEL` | Override provider default model |
| `LLM_DEFAULT_PROVIDER` | Default provider (default: `"openai"`) |
| `LLM_DEFAULT_MODEL` | Global default model override |

---

## Testing with the new client

### Fake providers via `providerFactories`

```typescript
import { createLlmClient } from "@tidepool/llm-client";
import type { AiProviderFactory } from "@tidepool/llm-client";

const fakeOpenAI: AiProviderFactory = () => ({
  call: async () => ({
    content: { sentiment: "positive", confidence: 0.95 },
    rawContent: '{"sentiment":"positive","confidence":0.95}',
    usage: { promptTokens: 10, completionTokens: 5 },
  }),
});

const ai = createLlmClient({
  registry,
  providers: { openai: { name: "openai", apiKey: "test", baseUrl: "http://unused", defaultModel: "test" } },
  providerFactories: { openai: fakeOpenAI },
});

const result = await ai.intent("sentiment").object({ prompt: "test", schema: SentimentSchema });
expect(result.output.sentiment).toBe("positive");
```

### Scoped overrides

Use `.scope()` or `.with()` to override provider/model for a specific test without rebuilding the client:
```typescript
const testAi = ai.scope({ forceReal: false });
```

### Capturing usage events

```typescript
const events: LLMUsageEvent[] = [];
const ai = createLlmClient({
  registry,
  providers: { /* ... */ },
  providerFactories: { openai: fakeOpenAI },
  usageRecorder: async (event) => { events.push(event); },
});

await ai.intent("sentiment").object({ prompt: "test", schema: SentimentSchema });
expect(events[0].operation).toBe("llm_call");
expect(events[0].status).toBe("success");
```

### Asserting on errors

```typescript
import { isAiError } from "@tidepool/llm-client";

try {
  await ai.intent("unknownIntent").object({ prompt: "...", schema });
} catch (err) {
  expect(isAiError(err, "invalid_request")).toBe(true);
  expect((err as AiError).retryable).toBe(false);
}
```
