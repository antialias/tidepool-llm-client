<img src="../logo-small.png" width="64" align="right" />

# Operations Reference

Complete API reference for the five operation kinds and concurrency control in `@tidepool/llm-client`.

## Overview

| Method | Operation kind | Return type | Required provider capability |
|--------|---------------|-------------|------------------------------|
| `.object(req)` | `text-object` | `AiObjectResult<T>` | `jsonSchema`, `text` |
| `.text(req)` | `text` | `AiTextResult` | `jsonSchema`, `text` |
| `.streamObject(req)` | `text-stream` | `AiStreamObjectResult<T>` | `jsonSchema`, `text`, `streaming` |
| `.embed(req)` | `embedding` | `AiEmbedResult` | `embeddings` |
| `.imageEdit(req)` | `image-edit` | `AiImageEditResult` | `imageEdit`, `references` |

All methods are `async` and return promises. All accept the [common request options](#common-request-options) described at the end of this document.

---

## `.object()` -- Structured output

Sends a prompt with a Zod schema. The client converts it to JSON Schema, sends it to the provider's structured-output endpoint, and validates the response against the Zod schema before returning.

### Request: `AiObjectRequest<TSchema>`

```typescript
interface AiObjectRequest<TSchema extends z.ZodType> extends AiRequestBase {
  schema: TSchema;                              // required -- Zod schema for the output
  images?: readonly string[];                   // base64 data URLs for vision
  reasoningEffort?: ReasoningEffort;            // "none"|"minimal"|"low"|"medium"|"high"|"xhigh"
  // ...plus all common request options
}
```

### Result: `AiObjectResult<T>`

| Field | Type | Description |
|-------|------|-------------|
| `operation` | `"text-object"` | Discriminant |
| `output` | `T` | Parsed, validated output matching your Zod schema |
| `usage` | `TokenUsage` | `{ promptTokens, completionTokens, totalTokens, cachedInputTokens?, reasoningTokens? }` |
| `rawResponse` | `string` | Raw JSON from the provider before parsing |
| `jsonSchema` | `string` | JSON Schema sent to the provider (pretty-printed) |

### Example

```typescript
const Forecast = z.object({
  location: z.string(),
  high: z.number().describe("High temp in F"),
  low: z.number().describe("Low temp in F"),
  conditions: z.enum(["sunny", "cloudy", "rainy", "snowy"]),
});

const result = await ai.intent("forecast").object({
  schema: Forecast,
  prompt: "What's the weather forecast for Portland, OR tomorrow?",
});

console.log(result.output.high);       // 72  -- fully typed
console.log(result.usage.totalTokens); // 385
```

### Validation feedback loop

When the response fails Zod validation, the client throws `AiError` with `kind: "schema_validation_failed"` and a `ValidationFeedback` describing the failing field. If the retry policy includes `"schema_validation_failed"`, the client automatically retries with the feedback injected into the next call so the model can self-correct. This runs up to `retry.attempts` additional times.

```typescript
const registry = defineIntentRegistry({
  forecast: {
    kind: "text-object",
    defaultModel: "openai/gpt-4.1",
    retry: { attempts: 2, on: ["schema_validation_failed"], backoffMs: [300, 1000] },
  },
});
```

---

## `.text()` -- Unstructured text

Returns a plain string. Internally, the client wraps the call in a `{ text: string }` JSON schema, extracts the `text` field, and returns it as `output`. This means `.text()` still goes through structured output under the hood -- the provider returns valid JSON, and the client unwraps it.

### Request: `AiTextRequest`

```typescript
interface AiTextRequest extends AiRequestBase {
  images?: readonly string[];          // base64 data URLs for vision
  reasoningEffort?: ReasoningEffort;   // reasoning effort level
  // ...plus all common request options
}
```

No `schema` field. The prompt (or messages) is the only required input.

### Result: `AiTextResult`

Same shape as `AiObjectResult` but with `operation: "text"` and `output: string`. The `jsonSchema` is always the internal `{ text: string }` wrapper schema.

### Example

```typescript
const result = await ai.intent("haiku").text({
  prompt: "Write a haiku about compilers.",
});

console.log(result.output);
// "Tokens become trees / optimized through many
//  passes / silicon speaks truth"
```

---

## `.streamObject()` -- Streaming structured output

Returns an `AsyncGenerator` of `StreamEvent<T>` values delivering reasoning summaries, output deltas, errors, and a final complete event with the validated object.

### Request: `AiStreamObjectRequest<TSchema>`

```typescript
interface AiStreamObjectRequest<TSchema extends z.ZodType> extends AiRequestBase {
  schema: TSchema;                          // required -- Zod schema
  images?: readonly string[];               // base64 data URLs for vision
  reasoning?: ReasoningConfig;              // { effort, summary? }
  // ...plus all common request options
}
```

Note: `reasoning` is a `ReasoningConfig` object (`{ effort, summary? }`), not a bare `ReasoningEffort` string.

### Result: `AiStreamObjectResult<T>`

```typescript
interface AiStreamObjectResult<T> extends AiResultBase {
  operation: "text-stream";
  stream: AsyncGenerator<StreamEvent<T>, void, unknown>;
}
```

Returned immediately (before events arrive). Token usage comes inside the `complete` event.

### Stream event types

The `StreamEvent<T>` union has five variants:

| Type | Fields | Description |
|------|--------|-------------|
| `started` | `responseId: string` | Stream opened. The response ID can be used for logging or cancellation. |
| `reasoning` | `text: string`, `summaryIndex: number`, `isDelta: boolean` | Reasoning summary text from the model's thinking process. May arrive in multiple deltas. |
| `output_delta` | `text: string`, `outputIndex: number` | Partial output text. Concatenate deltas for a running preview. |
| `error` | `message: string`, `code?: string` | An error occurred during streaming. The stream may continue or end. |
| `complete` | `data: T`, `usage: TokenUsage`, `rawResponse: string` | Stream finished. `data` is the validated output. |

All events carry an optional `sequence?: number` for ordering.

### Example

```typescript
const result = await ai.intent("analyze").streamObject({
  schema: AnalysisResult,
  prompt: analysisPrompt,
  reasoning: { effort: "high", summary: "auto" },
});

for await (const event of result.stream) {
  if (event.type === "reasoning") process.stdout.write(event.text);
  if (event.type === "output_delta") updatePreview(event.text);
  if (event.type === "complete") {
    console.log("Done:", event.data, "tokens:", event.usage.totalTokens);
  }
}
```

### No retry for streams

Streams run exactly once -- retry and fallback policies are ignored. If the provider fails, the error propagates as an `AiError` thrown from the generator. Wrap in your own retry loop if needed.

Concurrency control *is* applied: the slot is held from stream open until the generator finishes (completion, error, or consumer abandonment).

---

## `.embed()` -- Embeddings

Generates vector embeddings. Returns `Float32Array[]` -- one per input string.

### Request: `AiEmbedRequest`

```typescript
interface AiEmbedRequest extends AiRequestBase {
  input: string | readonly string[];    // one or more texts to embed
  dimensions?: number;                  // output dimensionality (if model supports it)
  // ...plus all common request options (prompt/messages are not used)
}
```

`prompt` and `messages` from `AiRequestBase` are ignored -- the text to embed comes from `input`.

### Result: `AiEmbedResult`

```typescript
interface AiEmbedResult extends AiResultBase {
  operation: "embedding";
  embeddings: readonly Float32Array[];
  usage: { promptTokens: number; totalTokens: number };  // no completionTokens
}
```

### Example

```typescript
const result = await ai.intent("search.embed").embed({
  input: ["The quick brown fox", "jumps over the lazy dog"],
  dimensions: 256,
});

console.log(result.embeddings.length);        // 2
console.log(result.embeddings[0].length);     // 256
console.log(result.usage.totalTokens);        // 12
```

### No fallback

Embedding calls disable fallback internally. Embeddings must come from the same model to be comparable -- mixing providers produces meaningless similarity scores. Retries (same provider) are still honored.

---

## `.imageEdit()` -- Image editing / generation

Generates images from a prompt with reference images. The provider must implement `AiImageProvider`.

### Request: `AiImageEditRequest`

```typescript
interface AiImageEditRequest extends AiRequestBase {
  referenceImages: readonly string[];    // required -- base64 data URLs of reference images
  size?: string;                         // e.g. "1024x1024", "1536x1024" (provider-specific)
  n?: number;                            // number of images to generate (default: 1)
  quality?: "low" | "medium" | "high";   // output quality tier
  // ...plus all common request options
}
```

`referenceImages` is always required (pass an empty array if generating from scratch, though most providers need at least one).

### Result: `AiImageEditResult`

Contains `operation: "image-edit"`, `images: readonly string[]` (base64-encoded), and `usage: AiImageUsage`.

### `AiImageUsage`

```typescript
interface AiImageUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  imageInputTokens?: number;   // tokens consumed by reference images
  imageOutputTokens?: number;  // tokens consumed by generated images
  raw?: unknown;               // provider-specific raw usage object
}
```

All fields are optional -- providers report different subsets.

### Example

```typescript
const reference = `data:image/png;base64,${readFileSync("input.png", "base64")}`;

const result = await ai.intent("illustration").imageEdit({
  prompt: "Make the sky a dramatic sunset with orange and purple clouds",
  referenceImages: [reference],
  size: "1024x1024",
  n: 2,
  quality: "high",
});

console.log(result.images.length);  // 2 -- each is a base64-encoded image string
writeFileSync("output.png", Buffer.from(result.images[0], "base64"));
```

### Auto-batching when `n` exceeds `maxImagesPerCall`

Some providers limit how many images a single API call can produce. Set `maxImagesPerCall` on the `ProviderConfig` (e.g., `maxImagesPerCall: 1` for OpenAI image edit). When `n` exceeds this limit, the client automatically splits the request into `ceil(n / maxImagesPerCall)` independent sub-calls. Each sub-call runs through the full middleware/retry/fallback pipeline and records its own usage events.

The results are merged: `images`, `attempts`, and any array-valued extension properties from middleware (e.g., file paths) are concatenated. If any sub-call fails, its error is thrown and remaining sub-calls are skipped.

---

## Concurrency control

### `ConcurrencyPool`

A generic bounded-concurrency executor with a FIFO slot queue.

```typescript
import { ConcurrencyPool } from "@tidepool/llm-client";

const pool = new ConcurrencyPool(5);  // max 5 concurrent operations
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `active` | `number` | Number of slots currently in use |
| `waiting` | `number` | Number of callers queued for a slot |
| `limit` | `number` | Maximum concurrent operations (read/write) |

Setting `limit` to a new value takes effect immediately. If the new limit is higher, queued waiters are drained. The limit must be >= 1.

#### `pool.run(fn, signal?)`

Wait for a slot, execute `fn`, release the slot when the promise settles. If `signal` is aborted while waiting, rejects immediately with `AbortError`.

```typescript
const result = await pool.run(() => fetch("https://api.openai.com/v1/..."));
```

#### `pool.acquire(signal?)`

Low-level slot acquisition. Returns a release function you call manually -- use for long-lived operations like streams. Calling the release function more than once is safe (no-op).

```typescript
const release = await pool.acquire();
try {
  for await (const chunk of someStream) { process.stdout.write(chunk); }
} finally {
  release();
}
```

#### `pool.map(items, fn, opts?)`

Bounded-concurrency map with `allSettled` semantics. One failure does not abort the rest. If `opts.signal` is aborted, in-flight items finish but no new items start.

```typescript
const results = await pool.map(prompts, async (prompt, i) => {
  return ai.text({ prompt });
});
// results is PromiseSettledResult<AiTextResult>[]
```

### `ProviderConcurrencyRegistry`

Lazily creates per-provider `ConcurrencyPool` instances. Providers not in the defaults map get limit 3.

```typescript
import { ProviderConcurrencyRegistry } from "@tidepool/llm-client";

const concurrency = new ProviderConcurrencyRegistry({
  openai: 8,
  anthropic: 5,
});
```

#### `registry.forProvider(provider)`

Returns the `ConcurrencyPool` for a provider, creating it if it doesn't exist. Provider names are case-insensitive.

#### `registry.setLimit(provider, limit)`

Update the concurrency limit at runtime. If the pool exists, its `limit` is updated in place (queued waiters may drain). If not yet created, the default is stored for later.

#### `registry.snapshot()`

Returns `Record<string, { active, waiting, limit }>` for all active pools. Useful for monitoring.

```typescript
console.log(concurrency.snapshot());
// { openai: { active: 3, waiting: 0, limit: 8 }, anthropic: { active: 5, waiting: 2, limit: 5 } }
```

### Integration with `createLlmClient`

Pass the registry via the `concurrency` option. The client acquires/releases slots for every provider call automatically.

```typescript
const ai = createLlmClient({
  registry,
  providers: config.providers,
  concurrency: new ProviderConcurrencyRegistry({ openai: 8, anthropic: 5 }),
});
```

For `.streamObject()`, the slot is held for the stream's lifetime. For all other operations, the slot covers only the API call duration.

---

## Common request options

All five operations extend `AiRequestBase`. These fields are available on every request:

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | Prompt text. Either `prompt` or `messages` is required. |
| `messages` | `AiMessage[]` | Structured `{ role, content }` messages. Roles: `"system"`, `"user"`, `"assistant"`. |
| `model` | `string \| AiModelReference` | Model override (`"provider/model"` or `{ provider, model }`). Defaults from intent/scope/client. |
| `provider` | `string` | Provider override. Prefer `"provider/model"` string format instead. |
| `intent` | `string` | Intent name. Must match a key in the registry. |
| `callSite` | `string` | Label for usage tracking and observability. |
| `timeoutMs` | `number` | Request timeout in milliseconds. |
| `temperature` | `number` | Sampling temperature. |
| `forceReal` | `boolean` | Bypass mock/debug routing -- send to the real provider API. |
| `usageContext` | `TUsageContext` | App-specific metadata attached to usage events. Merged with scope-level context. |
| `retry` | `AiRetryPolicy` | Per-request retry policy override. |
| `fallbackPolicy` | `AiFallbackPolicy` | Per-request fallback policy override. |

When both `messages` and `prompt` are provided, messages are formatted first (each as `### {role}\n{content}`), then the prompt is appended.

### `AiResultBase`

All results share: `provider`, `model`, `intent?`, `callSite?`, `usageContext?`, and `attempts: readonly AiAttempt[]`.

### `AiAttempt`

```typescript
interface AiAttempt {
  attempt: number;       // 1-indexed
  provider: string;
  model: string;
  isFallback: boolean;   // true if this attempt used a fallback model
}
```

The `attempts` array always has at least one entry. Retries and fallbacks append additional entries, giving full visibility into the resolution path.
