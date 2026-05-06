<img src="../logo-small.png" width="64" align="right" />

# Getting Started

You have 20 AI call sites and three developers. One day OpenAI deprecates the model you hardcoded everywhere. Or Anthropic ships something faster and cheaper, and you want to try it in two places without touching the other eighteen. Or a junior dev introduces a call with no retry logic and it brings down your queue on a Saturday night. `@tidepool/llm-client` exists so that none of these are emergencies.

It gives you a typed client where models, retries, and fallbacks are declared in one place (the intent registry), while call sites stay focused on what they actually need: a prompt, a schema, and a result.

## Install

```bash
pnpm add @tidepool/llm-client zod
```

Set your provider key. The client reads standard env vars -- no config file needed:

```bash
export OPENAI_API_KEY="sk-..."
```

That's enough to start. The client auto-discovers providers by checking for `{PROVIDER}_API_KEY` in the environment. `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` work the same way.

## Define your first intent

An intent is a named description of *what* an AI call is for, decoupled from *which* model runs it. You define them once, upfront, in a registry:

```typescript
import { defineIntentRegistry } from "@tidepool/llm-client";

const registry = defineIntentRegistry({
  "summarize-review": {
    kind: "text-object",
    defaultModel: "openai/gpt-4.1",
  },
});
```

`kind` tells the client what shape of operation this intent supports. `"text-object"` means structured output -- the model returns JSON that conforms to a Zod schema. Other kinds include `"text"`, `"text-stream"`, `"embedding"`, and `"image-edit"`.

The registry is frozen at creation time. It's a const object -- TypeScript will narrow intent names to string literals, so typos are caught at compile time.

## Create the client

```typescript
import { createLlmClient, loadConfigFromEnv } from "@tidepool/llm-client";

const config = loadConfigFromEnv();

const ai = createLlmClient({
  registry,
  providers: config.providers,
});
```

`loadConfigFromEnv()` reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and optional overrides like `OPENAI_BASE_URL` or `LLM_DEFAULT_MODEL` from `process.env`. It returns a config object with a `providers` map -- one entry per discovered key.

## Make a structured call

Here's the payoff. Define a Zod schema, pass it to `.object()`, and get a fully typed result back:

```typescript
import { z } from "zod";

const ReviewSummary = z.object({
  sentiment: z.enum(["positive", "negative", "mixed"]),
  keyPoints: z.array(z.string()).min(1).max(5),
  confidence: z.number().min(0).max(1),
});

const result = await ai
  .intent("summarize-review")
  .object({
    schema: ReviewSummary,
    prompt: `Summarize this product review:\n\n"The battery lasts forever but the screen is dim in sunlight. Overall I'd buy it again."`,
  });

// result.output is fully typed: { sentiment, keyPoints, confidence }
console.log(result.output.sentiment);   // "mixed"
console.log(result.output.keyPoints);   // ["Long battery life", "Dim screen in sunlight"]
console.log(result.output.confidence);  // 0.85
```

The client converts your Zod schema to JSON Schema, sends it to the provider's structured-output API, then validates the response against your schema before returning. If validation fails, it retries with feedback telling the model what went wrong -- automatically, if you configure retries on the intent (more on that below).

`result` also carries metadata: `result.usage` (token counts), `result.provider`, `result.model`, and `result.attempts` (the full attempt history including any retries or fallbacks).

## Make a text call

Sometimes you just need a string. Add a text intent to the registry and use `.text()`:

```typescript
const registry = defineIntentRegistry({
  "summarize-review": {
    kind: "text-object",
    defaultModel: "openai/gpt-4.1",
  },
  copywriting: {
    kind: "text",
    defaultModel: "openai/gpt-4.1-mini",
  },
});
```

```typescript
const tagline = await ai.intent("copywriting").text({
  prompt: "Write a one-sentence tagline for a weather app that shows e-ink forecasts on your wrist.",
});

console.log(tagline.output);
// "Your forecast, always on — never a charge away."
```

If you need to override the model for a single call, pass `model` on the request. The format is `"provider/model"`:

```typescript
const tagline = await ai.intent("copywriting").text({
  prompt: "Write a tagline...",
  model: "anthropic/claude-haiku-4-5",  // override just this call
});
```

## Scoped clients

Real applications don't make one-off calls. You have a request handler, a background job, a pipeline step -- each with its own context. Scoped clients let you set defaults once and reuse them:

```typescript
// .intent() pins the intent for all calls on this child client
const reviewer = ai.intent("summarize-review");

// .model() overrides the model
const cheapReviewer = reviewer.model("openai/gpt-4.1-mini");

// .callSite() tags calls for observability (shows up in usage logs)
const handler = cheapReviewer.callSite("POST /api/reviews");

// All three calls below inherit intent + model + callSite:
const r1 = await handler.object({ schema: ReviewSummary, prompt: review1 });
const r2 = await handler.object({ schema: ReviewSummary, prompt: review2 });
const r3 = await handler.object({ schema: ReviewSummary, prompt: review3 });
```

Every scope method returns a **new** client. The original is never mutated. You can branch freely:

```typescript
const base = ai.intent("summarize-review").callSite("batch-job");
const fast = base.model("openai/gpt-4.1-nano");
const smart = base.model("anthropic/claude-sonnet-4-6");
// base, fast, and smart are independent -- no shared mutable state.
```

For setting multiple scope fields at once, use `.with()`:

```typescript
const scoped = ai.with({
  intent: "summarize-review",
  callSite: "POST /api/reviews",
});
```

`.with()` and `.scope()` are aliases -- use whichever reads better at the call site.

## Handle errors

Every error the client throws is an `AiError` with a typed `kind` field. Use `isAiError` to branch:

```typescript
import { isAiError } from "@tidepool/llm-client";

try {
  const result = await ai.intent("summarize-review").object({
    schema: ReviewSummary,
    prompt: userInput,
  });
  return result.output;
} catch (err) {
  if (isAiError(err, "provider_rate_limited")) {
    // err is narrowed to AiError<"provider_rate_limited">
    console.warn("Rate limited, backing off...");
    return null;
  }
  if (isAiError(err, "schema_validation_failed")) {
    // The model returned JSON that didn't match your Zod schema,
    // even after retry attempts with validation feedback.
    console.error("Model output was malformed:", err.validationFeedback);
    return null;
  }
  if (isAiError(err, "context_too_large")) {
    console.error("Prompt too long for the model's context window.");
    return null;
  }
  throw err; // Unknown error -- let it propagate.
}
```

The full set of error kinds: `provider_rate_limited`, `provider_unavailable`, `provider_refused`, `provider_bad_response`, `provider_not_configured`, `model_not_configured`, `model_capability_mismatch`, `invalid_request`, `context_too_large`, `schema_validation_failed`, `timeout`, `cancelled`, `budget_exceeded`, `usage_record_failed`, `billing_failed`.

Every `AiError` also carries context: `.provider`, `.model`, `.intent`, `.callSite`, `.retryable`, `.userVisible`, and `.remediation` (a human-readable suggestion for what to do).

## Adding retries

The default retry policy is zero retries. To add retries, set them on the intent:

```typescript
const registry = defineIntentRegistry({
  "summarize-review": {
    kind: "text-object",
    defaultModel: "openai/gpt-4.1",
    retry: {
      attempts: 2,
      on: ["schema_validation_failed", "provider_rate_limited", "timeout"],
      backoffMs: [500, 2000],
    },
  },
});
```

`attempts` is the number of *retries* (not total attempts). With `attempts: 2`, the client will try up to 3 times. `on` lists which error kinds trigger a retry. `backoffMs` is a per-retry delay array -- the first retry waits 500ms, the second waits 2000ms.

For `schema_validation_failed` retries, the client automatically feeds the validation error back to the model so it can correct its output. You get this for free.

## What's next

This guide covers the core loop: registry, client, `.object()`, `.text()`, scoping, errors. The package also supports:

- **Streaming** -- `.streamObject()` returns an `AsyncGenerator` of partial results
- **Embeddings** -- `.embed()` for vector search
- **Image editing** -- `.imageEdit()` for reference-image-based generation
- **Plugins and middleware** -- `defineAiPlugin()` for cross-cutting concerns like logging, persistence, or cost tracking
- **Fallback policies** -- automatic failover to a backup provider/model when the primary is down
- **Concurrency control** -- `ProviderConcurrencyRegistry` for rate-limiting parallel calls per provider

See the other docs in this directory, or start from the type definitions in `src/operations.ts` and `src/plugins.ts`.
