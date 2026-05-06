# How @tidepool/llm-client compares

There are excellent LLM libraries in the TypeScript ecosystem. Here's why we built another one and where it fits.

## The short version

Most LLM libraries either give you a thin wrapper around provider SDKs or a full application framework. @tidepool/llm-client is neither — it's an **intent-based client** where call sites declare what they need, not which model to call, and reliability features like fallback, retry, and concurrency work out of the box with no cloud service required.

## Feature comparison

|  | @tidepool/llm-client | Vercel AI SDK | LangChain.js | Instructor | Mastra | BAML |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Intent-based model routing** | Yes | — | — | — | — | — |
| **Validation retry with error feedback** | Yes | — | — | Yes | — | — |
| **Typed error model (`kind` union)** | Yes | class-based | — | — | — | — |
| **Provider fallback (no cloud needed)** | Yes | cloud gateway only | Yes | — | Yes | — |
| **Per-provider concurrency pools** | Yes | — | — | — | — | — |
| **Scoped client chaining** | Yes | — | — | — | — | — |
| **Structured output (Zod)** | Yes | Yes | Yes | Yes | Yes | own DSL |
| **Streaming** | Yes | Yes | Yes | partial | Yes | partial |
| **Embeddings** | Yes | Yes | Yes | — | Yes | — |
| **Plugin / middleware hooks** | 6 hooks | 3 hooks | callbacks | — | callbacks | — |
| **Usage recording** | pluggable | OpenTelemetry | via add-ons | — | via add-ons | — |
| **Zero provider-SDK dependencies** | Yes | — | — | — | — | — |
| **Works without a cloud service** | Yes | Yes\* | Yes | Yes | Yes | Yes |

\* Vercel AI SDK's core works standalone, but the default getting-started flow routes through the Vercel AI Gateway (requires a Vercel account), and provider fallback requires it.

## What sets @tidepool/llm-client apart

### Call sites say what, not how

```ts
const result = await ai.intent('pipeline.sceneExtract').object({
  prompt: 'Extract the scene from this chapter',
  schema: SceneSchema,
})
```

Twenty call sites don't each hardcode a model name. When a model is retired or a better one ships, you change one line in the intent registry — not twenty files.

### No cloud service in the loop

Fallback, retry with backoff, per-provider concurrency limiting, and usage recording all run in your process. No gateway to deploy, no API key to manage, no network hop to a proxy. Your LLM calls go directly from your server to the provider.

### Minimal dependency surface

The library uses raw `fetch` to call providers — no OpenAI SDK, no Anthropic SDK, no transitive dependency tree. Two runtime dependencies: `zod` and `@paralleldrive/cuid2`.

### Errors you can branch on

```ts
catch (error) {
  if (isAiError(error, 'provider_rate_limited')) {
    // back off
  } else if (isAiError(error, 'schema_validation_failed')) {
    // log and inspect
  }
}
```

Every failure has a discrete `kind` — not a message string, not an HTTP status code, not an error class hierarchy.

### Validation retry is automatic

When a Zod schema rejects an LLM response, the validation error is fed back to the model as context for a corrected attempt. This happens transparently per the intent's retry policy.

## When to use something else

- **You're building a chat UI with React** — Vercel AI SDK's `useChat` and `useObject` hooks have no equivalent here.
- **You need agents, RAG, or workflow orchestration** — LangChain.js or Mastra are full frameworks; @tidepool/llm-client is a client library.
- **You want schema-first code generation across languages** — BAML's DSL compiler generates clients for TypeScript, Python, Go, and Ruby from a single schema definition.
- **You need 100+ providers** — gateway services like LiteLLM or Portkey route to hundreds of models. @tidepool/llm-client supports OpenAI, Anthropic, and Gemini directly, though it can sit behind a gateway for broader coverage.
