<img src="../logo-small.png" width="64" align="right" />

# Architecture

How `@tidepool/llm-client` is structured, how a call flows through it, and how the extension points connect.

## Call lifecycle

Every DSL call — `.object()`, `.text()`, `.streamObject()`, `.embed()`, `.imageEdit()` — follows the same path:

```
call site
  │
  ▼
┌─────────────────────┐
│  1. Create envelope  │  Merge scope + request → resolve intent → resolve model
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  2. Run with policy  │  Retry loop (same model) → fallback loop (different models)
└──────────┬──────────┘
           │  (per attempt)
           ▼
┌─────────────────────┐
│  3. Middleware chain  │  Plugins wrap the provider call (logging, persistence, etc.)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  4. Provider call    │  Build request → acquire concurrency slot → fetch → parse
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  5. Validate output  │  Zod parse (for .object()) → on failure, attach feedback
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  6. Record usage     │  Emit typed LLMUsageEvent to the recorder
└─────────────────────┘
```

### Step 1 — Envelope creation

The client merges all sources of configuration into an **operation envelope**: a frozen snapshot of everything needed to execute the call. This is where model resolution happens.

```ts
// Sources merged, in priority order:
const model    = request.model ?? scope.model ?? intent.defaultModel ?? client.defaultModel ?? provider.defaultModel
const provider = request.provider ?? scope.provider ?? (inferred from model string) ?? client.defaultProvider
const retry    = request.retry ?? scope.retry ?? intent.retry ?? { attempts: 0, on: [] }
const fallback = request.fallbackPolicy ?? scope.fallbackPolicy ?? intent.fallbackPolicy ?? { mode: 'none' }
```

The envelope also records: the operation kind (`text-object`, `text`, `text-stream`, `embedding`, `image-edit`), the Zod-derived JSON schema (for structured operations), the normalized prompt, a unique `retryGroupId`, and the merged `usageContext`.

### Step 2 — Retry and fallback

**Retry** re-runs the same provider+model. It's controlled by `AiRetryPolicy`:

```ts
{ attempts: 2, on: ['schema_validation_failed'], backoffMs: [300, 1000] }
```

For `schema_validation_failed`, the Zod error is fed back to the model as `validationFeedback` so it can self-correct.

**Fallback** switches to a different provider+model. It's controlled by `AiFallbackPolicy`:

```ts
{ mode: 'ordered', candidates: ['anthropic/claude-sonnet-4-20250514'], on: ['provider_rate_limited', 'provider_unavailable', 'timeout'] }
```

Only three error kinds are fallback-safe: `provider_rate_limited`, `provider_unavailable`, and `timeout`. Schema errors are never fallback candidates — if the model can't match your schema, a different model is unlikely to do better without the feedback loop.

Each fallback candidate gets its own full retry cycle.

### Step 3 — Middleware

Middleware wraps the provider call with a classic `(context, next) => result` pattern. Plugins contribute middleware in declaration order; the chain executes outside-in:

```ts
const ai = createLlmClient({
  plugins: [
    { name: 'telemetry', middleware: [timingMiddleware] },
    { name: 'persistence', middleware: [imagePersistMiddleware] },
  ],
})

// Execution order:
// timingMiddleware → imagePersistMiddleware → provider call → imagePersist return → timing return
```

Middleware receives the full `AiMiddlewareContext` (registry, scope, envelope, attempt, resolved model) and can transform the result, add properties, or short-circuit.

### Step 4 — Provider call

The client instantiates providers lazily via **provider factories**. Three are built in:

```ts
// Default factories
openai    → OpenAIDslProvider (chat completions + responses API + embeddings + image edit)
anthropic → AnthropicProvider (messages API)
gemini    → OpenAIProvider (OpenAI-compatible endpoint)
```

Custom factories extend the provider layer without forking the client:

```ts
const ai = createLlmClient({
  providerFactories: {
    localai: ({ providerConfig }) => new LocalAIProvider(providerConfig),
  },
})
```

If a `ProviderConcurrencyRegistry` is configured, the client acquires a slot before calling the provider and releases it after. For streams, the slot is held for the stream's lifetime.

All provider calls use raw `fetch` — no SDK dependencies.

### Step 5 — Validation

For `.object()` calls, the raw JSON response is parsed against the Zod schema. On failure:

1. The Zod error is converted to `ValidationFeedback` (field path + issue description)
2. An `AiError` with `kind: 'schema_validation_failed'` is thrown
3. If retry policy includes this kind, the feedback is injected into the next attempt's prompt

This creates a self-correcting loop: model produces bad output → Zod explains what's wrong → model tries again with that context.

### Step 6 — Usage recording

After every provider call (success or failure), the client emits an `LLMUsageEvent` to the configured `usageRecorder`. Events include: provider, model, intent, callSite, operation, token counts, duration, error details, and the app-specific `usageContext`.

---

## Scoped clients

`AiClient` is immutable. Every scope method returns a **new** client that inherits the parent's config and merges the new scope:

```ts
const base = createLlmClient({ registry, ...config })

// Each returns a new AiClient — base is unchanged
const scoped = base
  .intent('pipeline.sceneExtract')       // lock to an intent
  .callSite('chapter-processor')          // tag for usage tracking

// Equivalent one-shot:
const scoped = base.with({
  intent: 'pipeline.sceneExtract',
  callSite: 'chapter-processor',
})
```

Scoped clients are the mechanism for **gateway patterns** — application code that adds context between the library and call sites:

```ts
// Application gateway: resolve model from DB, return a scoped client
async function appCall({ intent, userId }) {
  const { provider, model } = await resolveModelFromDB(intent, userId)
  return getAiClient()
    .intent(intent)
    .model({ provider, model })
}

// Call site: no provider plumbing
const ai = await appCall({ intent: 'analyze.sentiment', userId })
const result = await ai.object({ schema: SentimentSchema, prompt: text })
```

---

## Plugin system

A plugin is a named bundle of middleware and hooks:

```ts
defineAiPlugin({
  name: 'cost-tracker',
  middleware: [costMiddleware],
  hooks: {
    afterSuccess: (ctx, result) => { /* log cost */ },
    afterError: (ctx, error) => { /* alert on budget */ },
  },
})
```

### Hooks

| Hook | When it fires | Use case |
|------|--------------|----------|
| `beforeResolve` | Before model resolution | Override resolution, audit |
| `beforeProviderCall` | After resolution, before fetch | Logging, request modification |
| `afterSuccess` | Provider returned successfully | Metrics, caching |
| `afterError` | Provider call failed | Alerting, error tracking |
| `afterRetry` | About to retry (same model) | Retry logging |
| `afterFallbackDecision` | Fallback evaluated | Fallback tracking |

Hooks are fire-and-forget — they can't modify the result. Middleware can.

---

## Error model

Every failure is an `AiError` with a discriminated `kind`:

```ts
type AiErrorKind =
  | 'model_not_configured'        // no model resolved
  | 'provider_not_configured'     // provider missing credentials
  | 'model_capability_mismatch'   // model can't do what the intent needs
  | 'invalid_request'             // bad intent name, wrong operation kind
  | 'context_too_large'           // prompt exceeds context window
  | 'schema_validation_failed'    // Zod rejected the output
  | 'provider_rate_limited'       // 429
  | 'provider_unavailable'        // 5xx, network failure
  | 'provider_refused'            // content filter, safety block
  | 'provider_bad_response'       // unparseable response
  | 'timeout'                     // request timed out
  | 'cancelled'                   // AbortSignal fired
  | 'budget_exceeded'             // app-level budget check
  | 'usage_record_failed'         // recorder threw
  | 'billing_failed'              // billing hook threw
```

Branch on `kind`, never on message strings:

```ts
import { isAiError } from '@tidepool/llm-client/errors'

if (isAiError(error, 'provider_rate_limited')) {
  // back off — or let the fallback policy handle it
}
```

---

## What's next

| Doc | What it covers |
|-----|---------------|
| [Getting Started](getting-started.md) | Install, first intent, first call |
| [Intents and Resolution](intents-and-resolution.md) | Resolution layers, capabilities, retry vs fallback |
| [Operations Reference](operations-reference.md) | `.object()`, `.text()`, `.streamObject()`, `.embed()`, `.imageEdit()` |
| [Writing Plugins](writing-plugins.md) | Hooks, middleware, stream persistence |
| [Migration Guide](migration.md) | From raw provider SDKs |
