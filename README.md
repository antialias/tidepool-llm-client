<p align="center">
  <img src="logo.png" width="200" alt="@tidepool/llm-client — the octopus at the switchboard" />
</p>

<h1 align="center">@tidepool/llm-client</h1>

<p align="center">
  <strong>Intent-based LLM client with typed errors, multi-provider routing,<br />and no silent fallback.</strong>
</p>

<p align="center">
  OpenAI &middot; Anthropic &middot; Gemini &nbsp;|&nbsp;
  Structured output &middot; Streaming &middot; Embeddings &middot; Image editing &nbsp;|&nbsp;
  Zod-validated &middot; Plugin-extensible
</p>

<p align="center">
  <a href="https://tidepool.one/api/catalog/book_8273e61447465e1b1fe790d1/artifacts?target=pdf&kind=pdf">Read the story (PDF)</a> — an illustrated walkthrough of the design
</p>

---

## Install

```sh
# npm (GitHub Packages)
echo "@antialias:registry=https://npm.pkg.github.com" >> .npmrc
npm install @antialias/llm-client
```

See [`examples/`](examples/) for runnable demos. The [`examples/next-streaming/`](examples/next-streaming/) app demonstrates three patterns for React/Next.js integration: SSE streaming, one-shot structured output, and RSC + Suspense.

---

Call sites say *what they need*, not *which model to use*. The client resolves
the model, validates capabilities, retries on failure, and surfaces typed
errors — so twenty call sites don't each reinvent provider plumbing.

```ts
import { createLlmClient, defineIntentRegistry, loadConfigFromEnv } from '@tidepool/llm-client'
import { z } from 'zod'

const intents = defineIntentRegistry({
  'analyze.sentiment': {
    kind: 'text-object',
    defaultModel: 'openai/gpt-5.4-mini',
    retry: { attempts: 1, on: ['schema_validation_failed'] },
  },
} as const)

const ai = createLlmClient({ registry: intents, ...loadConfigFromEnv() })

const result = await ai.intent('analyze.sentiment').object({
  prompt: 'Analyze: "I love this product!"',
  schema: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number().min(0).max(1),
  }),
})

result.output.sentiment // 'positive' | 'negative' | 'neutral' — fully typed
```

---

## Why this instead of _____?

There are excellent LLM libraries in the TypeScript ecosystem. Here's where @tidepool/llm-client fits.

|  | @tidepool/llm-client | Vercel AI SDK | LangChain.js | Instructor | Mastra | BAML |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Intent-based model routing** | :white_check_mark: | — | — | — | — | — |
| **Validation retry with error feedback** | :white_check_mark: | — | — | :white_check_mark: | — | — |
| **Provider fallback without a cloud service** | :white_check_mark: | :cloud: | :white_check_mark: | — | :white_check_mark: | — |
| **Per-provider concurrency pools** | :white_check_mark: | — | — | — | — | — |
| **Typed error model** | `kind` union | class hierarchy | — | — | — | — |
| **Zero provider-SDK dependencies** | :white_check_mark: | — | — | — | — | — |
| **No cloud service required** | :white_check_mark: | :white_check_mark:\* | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |

<sub>\* The Vercel AI SDK works without Vercel cloud, but its default getting-started flow routes through the Vercel AI Gateway, and provider fallback requires it.</sub>

**Semantics** — Call sites declare an intent (`"pipeline.sceneExtract"`), not a model name. When a model is retired or a better one ships, you change one line in the intent registry — not twenty files.

**Dependencies** — Two runtime dependencies: `zod` and `@paralleldrive/cuid2`. Provider calls use raw `fetch` — no OpenAI SDK, no Anthropic SDK, no transitive dependency tree.

**Self-contained reliability** — Fallback, retry with backoff, per-provider concurrency limiting, and usage recording all run in your process. No gateway to deploy, no extra API key to manage, no network hop to a proxy.

### When to use something else

- **Chat UI with React** — Vercel AI SDK's `useChat` and `useObject` hooks have no equivalent here.
- **Agents, RAG, or workflow orchestration** — LangChain.js and Mastra are full frameworks; this is a client library.
- **Schema-first codegen across languages** — BAML generates typed clients for TypeScript, Python, Go, and Ruby from a single schema definition.
- **100+ providers** — Gateway services like LiteLLM or Portkey route to hundreds of models. @tidepool/llm-client supports OpenAI, Anthropic, and Gemini directly, though it can sit behind any gateway for broader coverage.

---

## Documentation

| Guide | What it covers |
|-------|---------------|
| **[Architecture](docs/architecture.md)** | How a call flows through the system. Envelope creation, retry/fallback, middleware, provider layer, validation, scoped clients, and the gateway pattern. |
| **[Getting Started](docs/getting-started.md)** | Zero to working call. Install, define an intent, make structured and text calls, handle errors. |
| **[Intents and Resolution](docs/intents-and-resolution.md)** | The mental model. Why intents over model strings, resolution layers, capabilities, the full error model, retry and fallback. |
| **[Writing Plugins](docs/writing-plugins.md)** | The extension story. Hooks, middleware, stream persistence, usage recording — how to add telemetry and transform results without forking the client. |
| **[Operations Reference](docs/operations-reference.md)** | Every operation kind — `.object()`, `.text()`, `.streamObject()`, `.embed()`, `.imageEdit()` — plus concurrency control. |
| **[Migration Guide](docs/migration.md)** | Moving from raw OpenAI/Anthropic SDK calls. Before/after examples and step-by-step instructions. |
| **[Full Comparison](docs/comparison.md)** | Detailed breakdown of how @tidepool/llm-client compares to Vercel AI SDK, LangChain.js, Instructor, Mastra, and BAML. |

## Key ideas

**Intents are the unit of API.** A call site says `"pipeline.sceneExtract"`,
not `"gpt-5.4-mini"`. Model retirement is a one-line registry change, not a
20-file search-and-replace.

**Errors are typed, not stringly.** Every failure is an `AiError` with a
discrete `kind` — `provider_not_configured`, `schema_validation_failed`,
`timeout`, etc. Branch on `kind`, never on message strings.

**No silent fallback.** Missing credentials or capability mismatches throw
immediately. Fallback to a different model is opt-in per intent, not a
surprise.

**Plugins, not forks.** Telemetry, cost tracking, image persistence, debug
routing — all implemented as plugins with hooks and middleware. The client
never needs app-specific code.

## Subpath exports

```
@tidepool/llm-client                          Main API
@tidepool/llm-client/dsl                      AiClient internals
@tidepool/llm-client/intent-registry          defineIntentRegistry
@tidepool/llm-client/operations               Operation kinds, request/result types
@tidepool/llm-client/errors                   AiError, isAiError, error kinds
@tidepool/llm-client/config                   Env-based config loader
@tidepool/llm-client/plugins                  Plugin, middleware, hook types
@tidepool/llm-client/middleware               Base middleware types
@tidepool/llm-client/middleware/persistence   Stream snapshot middleware
@tidepool/llm-client/retry                    Retry helpers
@tidepool/llm-client/providers/base           Base provider class
@tidepool/llm-client/providers/openai         OpenAI provider
@tidepool/llm-client/providers/openai-dsl     OpenAI DSL provider
@tidepool/llm-client/providers/openai-responses  OpenAI Responses API
@tidepool/llm-client/providers/anthropic      Anthropic provider
@tidepool/llm-client/types                    Low-level types, provider error classes
@tidepool/llm-client/logger                   Pluggable logger
```

## Development

```sh
pnpm install
pnpm test            # vitest
pnpm type-check      # tsc --noEmit
pnpm build           # tsc -> dist/
```

ESM-only. Node >= 18. Published via semantic-release to
[GitHub Packages](https://github.com/antialias/tidepool-llm-client/packages).
