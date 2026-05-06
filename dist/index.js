/**
 * Intent-based LLM client with typed errors, multi-provider routing,
 * and no silent fallback.
 *
 * @example
 * ```typescript
 * import { createLlmClient, defineIntentRegistry, loadConfigFromEnv } from '@tidepool/llm-client'
 * import { z } from 'zod'
 *
 * const intents = defineIntentRegistry({
 *   'analyze.sentiment': {
 *     kind: 'text-object',
 *     defaultModel: 'openai/gpt-4.1',
 *     retry: { attempts: 1, on: ['schema_validation_failed'] },
 *   },
 * } as const)
 *
 * const ai = createLlmClient({ registry: intents, ...loadConfigFromEnv() })
 *
 * const result = await ai.intent('analyze.sentiment').object({
 *   prompt: 'Analyze: "I love this product!"',
 *   schema: z.object({
 *     sentiment: z.enum(['positive', 'negative', 'neutral']),
 *     confidence: z.number().min(0).max(1),
 *   }),
 * })
 *
 * result.output.sentiment // 'positive' | 'negative' | 'neutral'
 * ```
 *
 * @packageDocumentation
 */
// Concurrency
export { ConcurrencyPool, ProviderConcurrencyRegistry } from "./concurrency.js";
export { createLlmClient, AiClient, } from "./dsl.js";
export { defineIntentRegistry, } from "./intent-registry.js";
export { defineAiPlugin, } from "./plugins.js";
export { DEFAULT_AI_FALLBACK_POLICY, DEFAULT_AI_RETRY_POLICY, parseAiModelReference, } from "./operations.js";
export { AiError, isAiError, toAiError, } from "./errors.js";
// Config utilities
export { getConfiguredProviders, getProviderConfig, isProviderConfigured, loadConfigFromEnv, } from "./config.js";
export { Logger } from "./logger.js";
export { createPersistenceMiddleware, } from "./middleware/persistence.js";
export { AnthropicProvider } from "./providers/anthropic.js";
// Providers (for advanced usage / custom providers)
export { BaseProvider } from "./providers/base.js";
export { OpenAIDslProvider } from "./providers/openai-dsl.js";
export { OpenAIProvider } from "./providers/openai.js";
export { OpenAIResponsesProvider } from "./providers/openai-responses.js";
// Retry utilities (for advanced usage)
export { buildFeedbackPrompt, executeWithRetry, getRetryDelay, isRetryableError, } from "./retry.js";
// Logging utilities
// Errors
export { defaultLogger, LLMApiError, LLMContentFilterError, LLMJsonParseError, LLMNetworkError, LLMTimeoutError, LLMTruncationError, LLMValidationError, ProviderNotConfiguredError, } from "./types.js";
