<img src="../logo-small.png" width="64" align="right" />

# Intents and Resolution

How `@tidepool/llm-client` decouples your application logic from model selection -- and why that matters more than you think.

## The problem with model strings

Every LLM integration starts the same way: someone hardcodes `"gpt-4o"` into a function call. It works. Then it works in twelve more places. Then OpenAI retires the model, or you discover Anthropic is cheaper for summarization, or you need to A/B test two models against each other. Now you're grepping through 20 call sites, praying you don't miss one.

This is the string-coupling problem. Model names are infrastructure details. Your application logic shouldn't know or care that "the thing that extracts chapter metadata" happens to be `anthropic/claude-sonnet-4-20250514`. It should know that it needs structured JSON output and a model that can handle long documents.

`@tidepool/llm-client` solves this with **intents**: named, typed descriptions of what your AI calls are trying to accomplish. The model is resolved at call time through a layered system that gives you control at every level -- from global defaults down to individual function calls.

## Intents are the API

An intent is a named entry in a registry that declares three things: what kind of operation it performs, what capabilities it needs, and what model it should use by default.

```typescript
import { defineIntentRegistry } from "@tidepool/llm-client";

const intents = defineIntentRegistry({
  "chapter:extract-metadata": {
    kind: "text-object",
    requiredCapabilities: ["jsonSchema", "longContext"],
    defaultModel: "anthropic/claude-sonnet-4-20250514",
  },
  "chapter:summarize": {
    kind: "text",
    defaultModel: "openai/gpt-4o",
  },
  "scene:generate-art": {
    kind: "image-edit",
    defaultModel: "openai/gpt-image-1",
  },
  "search:embed-chunk": {
    kind: "embedding",
    defaultModel: "openai/text-embedding-3-small",
  },
  "chapter:stream-outline": {
    kind: "text-stream",
    requiredCapabilities: ["streaming", "jsonSchema"],
    defaultModel: "openai/gpt-4o",
  },
});
```

`defineIntentRegistry` returns a deeply frozen, fully typed object. The keys become a union type that flows through the client API, so typos in intent names are compile-time errors.

### `kind` constrains which method you can call

Each intent's `kind` maps to exactly one DSL method:

| `kind` | DSL method | What it does |
|--------|------------|-------------|
| `"text-object"` | `client.object()` | Structured JSON output validated against a Zod schema |
| `"text"` | `client.text()` | Plain text output |
| `"text-stream"` | `client.streamObject()` | Streaming structured output |
| `"embedding"` | `client.embed()` | Vector embeddings |
| `"image-edit"` | `client.imageEdit()` | Image generation/editing with reference images |

If you try to call `client.intent("search:embed-chunk").object(...)`, the client throws an `AiError` with kind `"invalid_request"` at resolution time -- before any provider call is made. The intent declared `kind: "embedding"`, so only `client.embed()` is valid. This catches bugs that would otherwise surface as mysterious provider errors deep in a retry loop.

### `requiredCapabilities`

Capabilities describe what the operation or model needs to support. The client checks operation-level capabilities (like `jsonSchema` and `streaming`) at intent resolution time. If your intent requires `streaming` but you call `client.object()`, that is a capability mismatch -- the operation does not provide streaming.

Model-level capabilities like `vision`, `reasoning`, and `longContext` are declared in the intent for documentation and can be validated by your application's resolver, but the client does not enforce them against a model catalog. That responsibility belongs to the layer above.

### The `AiIntentSpec` type

For reference, here is the full shape of an intent spec:

```typescript
interface AiIntentSpec {
  kind: AiOperationKind;
  requiredCapabilities?: readonly AiCapability[] | undefined;
  defaultModel?: AiModelReference | undefined;   // "provider/model" string
  retry?: AiRetryPolicy | undefined;
  fallbackPolicy?: AiFallbackPolicy | undefined;
}
```

Retry and fallback policies can be set per-intent, giving you fine-grained control. A cheap summarization intent might retry aggressively; an expensive image generation intent might not retry at all.

## Resolution layers

When you call `client.intent("chapter:summarize").text(...)`, the client needs to figure out which provider and model to use. It checks five sources, in order of priority:

1. **Per-call** -- `model` or `provider` passed directly in the request object
2. **Scope** -- `model` or `provider` set via `client.scope()` / `client.with()` / `client.model()`
3. **Intent default** -- the `defaultModel` from the intent registry
4. **Client default** -- `defaultModel` / `defaultProvider` from `createLlmClient()` config
5. **Provider default** -- `defaultModel` from the provider's config entry

The first source that provides a value wins. This means a per-call override always beats everything else, and a scope override beats the intent default.

### Scoped clients

`.scope()`, `.with()`, and `.child()` (all aliases) return a new `AiClient` with merged scope. Scopes compose:

```typescript
const client = createLlmClient({
  registry: intents,
  providers: { openai: { apiKey: "..." }, anthropic: { apiKey: "..." } },
  defaultProvider: "openai",
  defaultModel: "gpt-4o-mini",
});

// Scope locks the client to a specific model for all calls
const premium = client.scope({ model: "anthropic/claude-sonnet-4-20250514" });

// Intent + scope: scope wins over intent default
const result = await premium
  .intent("chapter:summarize")       // intent default is openai/gpt-4o
  .text({ prompt: "Summarize..." }); // but scope says anthropic/claude-sonnet-4
                                     // result uses anthropic/claude-sonnet-4

// Per-call override beats scope
const result2 = await premium
  .intent("chapter:summarize")
  .text({
    prompt: "Summarize...",
    model: "openai/gpt-4o-mini",     // per-call wins over everything
  });
```

### `ResolvedAiModel.source`

Every result includes a `source` field that tells you which layer provided the model -- critical for debugging "why did this call use *that* model?"

```typescript
interface ResolvedAiModel {
  provider: string;          // e.g. "anthropic"
  model: string;             // e.g. "claude-sonnet-4-20250514"
  source: AiResolutionSource;
}
```

The possible `source` values are:

| Source | Meaning |
|--------|---------|
| `"call"` | Model or provider was specified in the request object |
| `"scope"` | Came from a `.scope()` / `.with()` / `.model()` chain |
| `"intent"` | Used the intent's `defaultModel` |
| `"client-default"` | Used the client-level `defaultModel` or `defaultProvider` |
| `"provider-default"` | Used the provider config's `defaultModel` (last resort) |
| `"fallback"` | Model was selected by the fallback policy after a failure |
| `"user"` | Reserved for app-level resolution (e.g. user preferences from a DB) |
| `"sitewide"` | Reserved for app-level resolution (e.g. admin config from a DB) |

The `"user"` and `"sitewide"` sources are not set by the client itself -- they exist so that application-level gateways can mark their resolution source accurately.

## The gateway pattern

A common need in web applications: an admin sets a default model in a database, and individual users can override it. The client's resolution layers make this natural. The pattern is a function that reads config from storage, constructs a scoped client, and returns it. Call sites never touch model strings.

```typescript
import { createLlmClient } from "@tidepool/llm-client";

const intents = defineIntentRegistry({
  "doc:summarize": { kind: "text", defaultModel: "openai/gpt-4o" },
  "doc:extract":   { kind: "text-object", defaultModel: "openai/gpt-4o" },
});

async function loadModelConfig(userId: string) {
  // SELECT model_tag FROM user_prefs; SELECT default_model FROM site_config
  return {
    userOverride: userId === "power-user" ? "anthropic/claude-sonnet-4-20250514" : null,
    sitewideDefault: "openai/gpt-4o-mini",
  };
}

async function createGatewayClient(userId: string) {
  const config = await loadModelConfig(userId);
  const base = createLlmClient({
    registry: intents,
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY! },
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    },
  });
  return base.scope({
    model: config.userOverride ?? config.sitewideDefault,
    usageContext: { userId },
  });
}

// Call site: no model strings, no config awareness
async function handleSummarize(userId: string, document: string) {
  const ai = await createGatewayClient(userId);
  return (await ai.intent("doc:summarize").text({
    prompt: `Summarize this document:\n\n${document}`,
  })).output;
}
```

The gateway centralizes model selection. Change the default for all users by updating one database row. Upgrade a user to a premium model by updating their preference. The call sites never change.

## Capabilities: two kinds

Capabilities serve two distinct purposes, and confusing them leads to bugs.

### Operation-level capabilities

These describe what a DSL method provides. Enforced by `assertIntentCanRunOperation` at resolution time -- if your intent requires a capability the operation does not provide, the call fails immediately.

| Operation kind | Capabilities provided |
|---------------|----------------------|
| `"text-object"` | `jsonSchema`, `text` |
| `"text"` | `jsonSchema`, `text` |
| `"text-stream"` | `jsonSchema`, `text`, `streaming` |
| `"embedding"` | `embeddings` |
| `"image-edit"` | `imageEdit`, `references` |

### Model-level capabilities

These describe what a model can do, independent of the operation. The client does not enforce them -- they exist so your application layer can validate model-intent compatibility:

| Capability | Meaning |
|-----------|---------|
| `vision` | Model accepts image inputs |
| `reasoning` | Model supports chain-of-thought / reasoning effort |
| `longContext` | Model has an extended context window |

The full `AiCapability` union:

```typescript
type AiCapability =
  | "jsonSchema" | "text" | "streaming"    // operation-level
  | "embeddings" | "imageEdit" | "references"
  | "vision" | "reasoning" | "longContext"; // model-level
```

When defining an intent, you can mix both kinds in `requiredCapabilities`. The client checks the operation-level ones; your application checks the model-level ones.

## The error model

Every error from the client is an `AiError` with a typed `kind` discriminator -- no parsing error messages or checking HTTP status codes.

### All `AiErrorKind` values

| Kind | Retryable | Fallback-safe | Meaning |
|------|-----------|---------------|---------|
| `model_not_configured` | No | No | No model could be resolved for the provider |
| `provider_not_configured` | No | No | Provider has no credentials or no factory |
| `model_capability_mismatch` | No | No | Intent requires a capability the operation cannot provide |
| `invalid_request` | No | No | Bad request parameters, unknown intent, or kind mismatch |
| `context_too_large` | No | No | Prompt exceeds the model's context window |
| `schema_validation_failed` | Yes | No | Provider response failed Zod schema validation |
| `provider_rate_limited` | Yes | Yes | HTTP 429 from the provider |
| `provider_unavailable` | Yes | Yes | Provider returned 5xx or network error |
| `provider_refused` | No | No | Content filter or safety policy rejection |
| `provider_bad_response` | No | No | Unparseable or unexpected provider response |
| `timeout` | Yes | Yes | Request exceeded `timeoutMs` |
| `cancelled` | No | No | AbortController signal fired |
| `budget_exceeded` | No | No | Application-level spending limit hit |
| `usage_record_failed` | No | No | The usage recorder callback threw |
| `billing_failed` | No | No | Application-level billing hook rejected the call |

### `AiError` properties

```typescript
class AiError<TKind extends AiErrorKind = AiErrorKind> extends Error {
  readonly kind: TKind;
  readonly remediation?: string;       // human-readable fix suggestion
  readonly intent?: string;            // which intent was active
  readonly callSite?: string;          // caller-provided label
  readonly provider?: string;          // which provider failed
  readonly model?: string;             // which model failed
  readonly resolutionSource?: AiResolutionSource;
  readonly retryable: boolean;         // hint: can this be retried?
  readonly userVisible: boolean;       // safe to show to end users?
  readonly validationFeedback?: ValidationFeedback;  // for schema failures
  readonly originalCause?: Error;      // the underlying provider error
}
```

Every `AiError` carries enough context to diagnose the failure without digging through logs. The `remediation` field gives a plain-English fix suggestion.

### `isAiError` for type-safe branching

`isAiError` is overloaded: call it with just the error to check if it is any `AiError`, or pass a specific `kind` to narrow the type.

```typescript
import { isAiError } from "@tidepool/llm-client";

try {
  const result = await ai.intent("chapter:extract-metadata").object({
    schema: chapterSchema,
    prompt: chapterText,
  });
} catch (error) {
  if (isAiError(error, "provider_rate_limited")) {
    // error is AiError<"provider_rate_limited"> -- TypeScript knows
    console.log(`Rate limited by ${error.provider}. ${error.remediation}`);
    await showUserMessage("Too many requests, please wait a moment.");
  } else if (isAiError(error, "context_too_large")) {
    // error is AiError<"context_too_large">
    console.log(`Chapter too long for ${error.model}`);
    await splitAndRetry(chapterText);
  } else if (isAiError(error)) {
    // Catch-all for any AiError
    if (error.userVisible) {
      await showUserMessage(error.message);
    }
    console.error(`[${error.kind}] ${error.intent}: ${error.message}`);
  } else {
    // Not an AiError at all -- some other exception
    throw error;
  }
}
```

### `toAiError`

`toAiError` normalizes any thrown value into an `AiError`. It maps provider-specific error classes to the appropriate kind: HTTP 429 becomes `provider_rate_limited`, 5xx becomes `provider_unavailable`, `AbortError` becomes `cancelled`, anything unrecognized becomes `provider_bad_response`. The client uses it internally; it is exported for middleware authors who catch raw provider errors.

## Retry and fallback

Retry and fallback are distinct recovery strategies. Retry hits the same provider and model again. Fallback switches to a different model. Both are off by default.

### Retry policy

```typescript
interface AiRetryPolicy {
  attempts: number;                    // retries after the first attempt (default: 0)
  on: readonly AiErrorKind[];          // which error kinds trigger a retry
  backoffMs?: readonly number[];       // per-retry delay (index 0 = delay before retry 1)
}
```

The default policy is `{ attempts: 0, on: [] }` -- no retries. You opt in per-intent, per-scope, or per-call:

```typescript
const intents = defineIntentRegistry({
  "chapter:extract-metadata": {
    kind: "text-object",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    retry: {
      attempts: 2,
      on: ["schema_validation_failed", "provider_rate_limited", "timeout"],
      backoffMs: [1000, 3000],
    },
  },
});
```

The `shouldRetry` check is simple: `attempt <= policy.attempts && policy.on.includes(error.kind)`.

### The validation feedback loop

When a retry is triggered by `schema_validation_failed`, the client captures the validation feedback (which field failed, what the error was, what the model returned) and feeds it back to the provider on the next attempt:

```
Attempt 1:  prompt + schema  -->  model  -->  { "count": "three" }  -->  FAIL (count must be number)
Attempt 2:  prompt + schema + "field 'count' must be number, got 'three'"  -->  model  -->  { "count": 3 }  -->  OK
```

This is why `schema_validation_failed` is retryable but not fallback-safe. The feedback loop is specific to the model that produced the bad output -- falling back to a different model and telling it "you said X wrong" makes no sense.

### Fallback policy

```typescript
type AiFallbackPolicy =
  | { mode: "none" }
  | { mode: "ordered"; candidates: readonly AiModelReference[]; on: readonly AiErrorKind[] };
```

The default is `{ mode: "none" }`. When set to `"ordered"`, the client tries each candidate in sequence after the primary model (and all its retries) have been exhausted.

```typescript
const intents = defineIntentRegistry({
  "chapter:summarize": {
    kind: "text",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    retry: { attempts: 1, on: ["provider_rate_limited"] },
    fallbackPolicy: {
      mode: "ordered",
      candidates: ["openai/gpt-4o", "openai/gpt-4o-mini"],
      on: ["provider_rate_limited", "provider_unavailable", "timeout"],
    },
  },
});
```

With this config, a rate-limited call goes:

1. `anthropic/claude-sonnet-4` attempt 1 -- rate limited
2. `anthropic/claude-sonnet-4` attempt 2 (retry) -- still rate limited
3. `openai/gpt-4o` attempt 1 (fallback) -- succeeds

### Only three error kinds are fallback-safe

The `canFallback` function enforces a hard constraint: regardless of what you put in the policy's `on` array, only these three kinds actually trigger a fallback:

- `provider_rate_limited` -- the provider is throttling you, a different provider won't be
- `provider_unavailable` -- the provider is down, a different provider might not be
- `timeout` -- the provider is slow, a different provider might be faster

Everything else is not safe to retry on a different model. `schema_validation_failed` loses the feedback loop. `provider_refused` means the content was rejected -- sending it elsewhere is unlikely to help. `invalid_request` is a bug in your code, not a transient failure.

This is a deliberate design constraint. The `on` field in `AiFallbackPolicy` is an intersection with the fallback-safe set, not a bypass. If you put `"schema_validation_failed"` in `on`, it will be ignored.

### Each fallback candidate gets its own retry cycle

When the client falls back to a candidate model, that candidate gets a fresh retry cycle using the same retry policy. So with `attempts: 1` and two fallback candidates, the worst case is six total provider calls: 2 on primary, 2 on first fallback, 2 on second fallback. The `attempts` array on the result tracks every single one.

### Resolution source on fallback

When a fallback model is used, `resolvedModel.source` is `"fallback"`. This lets your logging and analytics distinguish "we used the model we wanted" from "we fell back because something went wrong." The `AiFallbackDecision` hook fires before each fallback attempt, giving plugins visibility into the decision.
