/**
 * Type-safe LLM client with multi-provider support, Zod schema validation,
 * streaming, embeddings, and retry logic with validation feedback.
 *
 * @example
 * ```typescript
 * import { LLMClient } from '@tidepool/llm-client'
 * import { z } from 'zod'
 *
 * const llm = new LLMClient()
 *
 * const SentimentSchema = z.object({
 *   sentiment: z.enum(['positive', 'negative', 'neutral']),
 *   confidence: z.number().min(0).max(1),
 * })
 *
 * const response = await llm.call({
 *   prompt: 'Analyze sentiment: "I love this product!"',
 *   schema: SentimentSchema,
 *   onProgress: (p) => console.log(p.message),
 * })
 *
 * console.log(response.data.sentiment) // 'positive'
 * ```
 *
 * @packageDocumentation
 */
// Concurrency
export { ConcurrencyPool, ProviderConcurrencyRegistry } from "./concurrency.js";
// Main client
export { LLMClient } from "./client.js";
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
