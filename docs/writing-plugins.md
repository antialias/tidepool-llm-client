<img src="../logo-small.png" width="64" align="right" />

# Writing Plugins

Plugins are the primary extension point for `@tidepool/llm-client`. They let you observe, measure, and transform every AI operation without touching the core client code.

## The extension model

Three concepts, layered:

| Concept | What it does | Defined as |
|---|---|---|
| **Plugin** | A named container that groups middleware and hooks together | `{ name, middleware?, hooks? }` |
| **Middleware** | Wraps individual operation attempts. Can observe, time, modify, or short-circuit results. | `(context, next) => Promise<Result>` |
| **Hooks** | Fire at specific lifecycle points. Observe-only -- they cannot change the result. | Callbacks on an `AiHooks` object |

A plugin can provide middleware, hooks, or both. Registration order matters: hooks fire in order, middleware wraps in order (first = outermost).

## Your first hook

Hooks fire at lifecycle boundaries and receive read-only context about the operation.

### `afterSuccess` -- telemetry

```typescript
import { defineAiPlugin } from "@tidepool/llm-client";

const telemetryPlugin = defineAiPlugin({
  name: "telemetry",
  hooks: {
    afterSuccess(context, result) {
      console.log(
        `[ai] ${context.envelope.operation} via ` +
        `${context.resolvedModel.provider}/${context.resolvedModel.model}`,
        `attempt=${context.attempt} intent=${context.scope.intent ?? "none"}`,
      );
    },
  },
});
```

The first argument to every hook is a lifecycle context. Its shape:

```typescript
interface AiLifecycleContext {
  registry: TRegistry;               // your intent registry
  scope: Readonly<AiClientScope>;    // active scope (intent, callSite, provider, model, usageContext)
  envelope: AiOperationEnvelope;     // full operation envelope (request, resolvedModel, retry policy, etc.)
  attempt: number;                   // 1-indexed attempt number
  resolvedModel: ResolvedAiModel;    // { provider, model, source }
}
```

### `afterError` -- Sentry reporting

```typescript
import * as Sentry from "@sentry/node";
import { defineAiPlugin } from "@tidepool/llm-client";

const sentryPlugin = defineAiPlugin({
  name: "sentry",
  hooks: {
    afterError(context, error) {
      Sentry.captureException(error, {
        tags: {
          aiProvider: context.resolvedModel.provider,
          aiModel: context.resolvedModel.model,
          aiIntent: context.scope.intent ?? "unknown",
          aiErrorKind: error.kind,
        },
        extra: {
          attempt: context.attempt,
          callSite: context.scope.callSite,
          retryable: error.retryable,
        },
      });
    },
  },
});
```

The `error` is always an `AiError` with structured metadata: `kind` (e.g. `"provider_rate_limited"`, `"timeout"`), `retryable`, `provider`, `model`, and optionally `validationFeedback`.

## All six hook points

All hooks are optional and async-safe (return a `Promise` if you need to).

### `beforeResolve`

Fires before provider/model resolution. Receives an `AiResolveContext` (no `resolvedModel` yet):

```typescript
interface AiResolveContext {
  registry: TRegistry;
  scope: Readonly<AiClientScope>;
  operation: AiOperationKind;   // "text-object" | "text" | "text-stream" | "embedding" | "image-edit"
  intent?: string;
  callSite?: string;
}
```

### `beforeProviderCall`

Fires after model resolution, just before the HTTP call. Receives the full `AiLifecycleContext`.

### `afterSuccess`

Fires when a call succeeds and validation passes. Receives lifecycle context + the operation result.

### `afterError`

Fires on every failed attempt, whether or not a retry follows. Receives lifecycle context + `AiError`. Fires *before* `afterRetry`.

### `afterRetry`

Fires when a failed attempt will be retried (error matched retry policy, attempts remain). Same signature as `afterError`.

### `afterFallbackDecision`

Fires when the client decides whether to fall back. Receives:

```typescript
interface AiFallbackDecision {
  from: ResolvedAiModel;
  to?: ResolvedAiModel;     // undefined if not falling back
  reason: AiError;
  willFallback: boolean;
}
```

## Writing middleware

Middleware wraps a single attempt execution. It receives a context object and a `next` function. Call `next()` to proceed to the actual provider call (or the next middleware in the chain). Return the result.

The signature:

```typescript
type AiMiddleware = (
  context: AiMiddlewareContext,
  next: () => Promise<AiOperationResult>,
) => Promise<AiOperationResult>;
```

`AiMiddlewareContext` is identical to `AiLifecycleContext` -- it carries `registry`, `scope`, `envelope`, `attempt`, and `resolvedModel`.

### Timing middleware

```typescript
import { defineAiPlugin } from "@tidepool/llm-client";

const timingPlugin = defineAiPlugin({
  name: "timing",
  middleware: [
    async (context, next) => {
      const start = performance.now();
      try {
        const result = await next();
        console.log(
          `[timing] ${context.envelope.operation} ` +
          `${context.resolvedModel.provider}/${context.resolvedModel.model} ` +
          `${(performance.now() - start).toFixed(0)}ms`
        );
        return result;
      } catch (error) {
        console.log(
          `[timing] ${context.envelope.operation} FAILED ` +
          `after ${(performance.now() - start).toFixed(0)}ms`
        );
        throw error;
      }
    },
  ],
});
```

### Result-enriching middleware

Middleware can augment the result object. This is how the portal adds persistence paths to image-edit results, for example.

```typescript
import { defineAiPlugin } from "@tidepool/llm-client";

const enrichPlugin = defineAiPlugin({
  name: "enrich-metadata",
  middleware: [
    async (context, next) => {
      const result = await next();
      // Spread extra fields onto the result
      return {
        ...result,
        resolvedAt: new Date().toISOString(),
        wasScoped: context.scope.intent !== undefined,
      };
    },
  ],
});
```

Middleware executes as a chain: `mw1 -> mw2 -> provider call`. Each calls `next()` to proceed; results flow back up in reverse order.

## Defining a plugin with `defineAiPlugin`

`defineAiPlugin` is an identity function that provides type inference for your plugin. A full plugin with both hooks and middleware:

```typescript
import { defineAiPlugin } from "@tidepool/llm-client";
import type { MyAppRegistry, MyUsageContext } from "./ai-config.js";

export const observabilityPlugin = defineAiPlugin<MyAppRegistry, MyUsageContext>({
  name: "observability",

  middleware: [
    async (context, next) => {
      const span = tracer.startSpan("ai.operation", {
        attributes: {
          "ai.operation": context.envelope.operation,
          "ai.provider": context.resolvedModel.provider,
          "ai.model": context.resolvedModel.model,
          "ai.intent": context.scope.intent ?? "",
        },
      });
      try {
        const result = await next();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  ],

  hooks: {
    afterError(context, error) {
      metrics.increment("ai.errors", { kind: error.kind });
    },
    afterFallbackDecision(decision) {
      if (decision.willFallback) {
        metrics.increment("ai.fallbacks");
      }
    },
  },
});
```

Register plugins in `createLlmClient`:

```typescript
const ai = createLlmClient({
  registry: myIntentRegistry,
  providers: { openai: openaiConfig, anthropic: anthropicConfig },
  defaultProvider: "openai",
  plugins: [observabilityPlugin, sentryPlugin],
});
```

Array order matters: middleware from earlier plugins wraps later ones (earlier = outermost). Hooks from all sources (top-level `hooks` on client config, then each plugin's `hooks`) fire sequentially.

## Stream middleware (persistence)

Streaming operations (`streamObject`) use a separate middleware system that wraps the `AsyncGenerator` itself:

```typescript
interface StreamMiddleware {
  wrap<T>(
    stream: AsyncGenerator<StreamEvent<T>, void, unknown>,
  ): AsyncGenerator<StreamEvent<T>, void, unknown>;
}
```

The built-in `createPersistenceMiddleware` accumulates streaming text and fires callbacks -- per-event (real-time UI) and periodic snapshots (DB persistence):

```typescript
import { createPersistenceMiddleware } from "@tidepool/llm-client";

const middleware = createPersistenceMiddleware({
  // Snapshot interval for DB writes (default: 3000ms)
  snapshotIntervalMs: 3000,

  // Per-event callback -- fires on every output_delta
  onOutputDelta(text, accumulated) {
    socket.emit("output:delta", { text, accumulated });
  },

  // Per-event callback -- fires on every reasoning event
  onReasoning(text, isDelta, accumulated) {
    socket.emit("reasoning", { text, isDelta });
  },

  // Periodic callback -- fires every snapshotIntervalMs + on stream end
  onOutputSnapshot: async (text) => {
    await db.update(runId, { outputText: text });
  },

  // Periodic callback -- fires every snapshotIntervalMs + on stream end
  onReasoningSnapshot: async (text) => {
    await db.update(runId, { reasoningText: text });
  },
});
```

All four callbacks are optional. Snapshots always fire one final time when the stream ends (success, error, or cancellation), so you never lose the tail.

## Usage recording

The client supports a `usageRecorder` callback for billing and audit logging. It fires on every provider call (success or failure) with structured usage data.

```typescript
import { createLlmClient, type LLMUsageEvent } from "@tidepool/llm-client";

const ai = createLlmClient({
  registry: myRegistry,
  providers: { openai: openaiConfig },
  defaultProvider: "openai",

  usageRecorder: async (event: LLMUsageEvent<MyUsageContext>) => {
    await db.insert(aiUsageLedger).values({
      operation: event.operation,      // "llm_call" | "llm_stream" | "embedding" | "image_edit"
      status: event.status,            // "success" | "error"
      provider: event.provider,
      model: event.model,
      durationMs: event.durationMs,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      totalTokens: event.totalTokens,
      errorKind: event.errorKind,      // present on errors
      errorMessage: event.errorMessage,
      bookId: event.usageContext?.bookId,
    });
  },
});
```

The `TUsageContext` generic flows through the entire client -- define it once at client creation, and every request, result, and usage event carries the same type:

```typescript
interface MyUsageContext { bookId: string; stepName: string }

const ai = createLlmClient<typeof myRegistry, MyUsageContext>({ /* ... */ });

// usageContext is type-checked everywhere
await ai.scope({ usageContext: { bookId: "b1", stepName: "generate" } })
  .object({ schema: mySchema, prompt: "..." });
```

A retried operation records one event per attempt, all sharing the same `retryGroupId`. If the recorder throws, the client wraps it in an `AiError` with `kind: "usage_record_failed"`.
