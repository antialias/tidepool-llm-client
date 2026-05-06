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
export { ConcurrencyPool, ProviderConcurrencyRegistry } from "./concurrency.js";
export { createLlmClient, AiClient, type AiClientConfig, type AiClientScopeInput, type AiProviderFactory, type AiProviderFactoryInput, type AiProviderInstance, } from "./dsl.js";
export { defineIntentRegistry, type AiIntentName, type AiIntentRegistry, type AiIntentRegistrySpec, type AiIntentSpec, type DeepReadonly, } from "./intent-registry.js";
export { defineAiPlugin, type AiClientScope, type AiFallbackDecision, type AiHooks, type AiLifecycleContext, type AiMiddleware, type AiMiddlewareContext, type AiMiddlewareNext, type AiPlugin, type AiResolveContext, } from "./plugins.js";
export { DEFAULT_AI_FALLBACK_POLICY, DEFAULT_AI_RETRY_POLICY, parseAiModelReference, type AiAttempt, type AiCapability, type AiEmbedOperationEnvelope, type AiEmbedRequest, type AiEmbedResult, type AiEmbeddingProvider, type AiFallbackPolicy, type AiImageEditOperationEnvelope, type AiImageEditRequest, type AiImageEditResult, type AiImageProvider, type AiImageUsage, type AiMessage, type AiMessageRole, type AiModelReference, type AiObjectOperationEnvelope, type AiObjectRequest, type AiObjectResult, type AiOperationEnvelope, type AiOperationEnvelopeBase, type AiOperationKind, type AiOperationResult, type AiProviderCallOutcome, type AiProviderCallSuccess, type AiProviderCallValidationFailure, type AiProviderEmbeddingRequest, type AiProviderEmbeddingResponse, type AiProviderImageEditRequest, type AiProviderImageEditResponse, type AiProviderStreamObjectRequest, type AiRequestBase, type AiRetryPolicy, type AiStreamingProvider, type AiStreamObjectOperationEnvelope, type AiStreamObjectRequest, type AiStreamObjectResult, type AiTextOperationEnvelope, type AiTextRequest, type AiTextResult, type ParsedAiModelReference, type ResolvedAiModel, } from "./operations.js";
export { AiError, isAiError, toAiError, type AiErrorContext, type AiErrorDetails, type AiErrorKind, type AiResolutionSource, } from "./errors.js";
export { getConfiguredProviders, getProviderConfig, isProviderConfigured, loadConfigFromEnv, } from "./config.js";
export { Logger } from "./logger.js";
export type { StreamMiddleware } from "./middleware.js";
export { createPersistenceMiddleware, type PersistenceOptions, } from "./middleware/persistence.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export { BaseProvider } from "./providers/base.js";
export { OpenAIDslProvider } from "./providers/openai-dsl.js";
export { OpenAIProvider } from "./providers/openai.js";
export { OpenAIResponsesProvider } from "./providers/openai-responses.js";
export type { RetryOptions } from "./retry.js";
export { buildFeedbackPrompt, executeWithRetry, getRetryDelay, isRetryableError, } from "./retry.js";
export type { EmbeddingRequest, EmbeddingResponse, LLMClientConfig, LLMProgress, LLMProvider, LLMRequest, LLMResponse, LLMStreamRequest, LLMOperation, LoggerFn, LoggingConfig, LogLevel, ProviderConfig, ProviderBaseUrlOverride, ProviderBaseUrlOverrideInput, ProviderRequest, ProviderResponse, ReasoningConfig, ReasoningEffort, StreamEvent, StreamEventComplete, StreamEventError, StreamEventOutputDelta, StreamEventReasoning, StreamEventStarted, LLMUsageEvent, LLMUsageRecorder, LLMUsageStatus, TokenUsage, ValidationFeedback, } from "./types.js";
export { defaultLogger, LLMApiError, LLMContentFilterError, LLMJsonParseError, LLMNetworkError, LLMTimeoutError, LLMTruncationError, LLMValidationError, ProviderNotConfiguredError, } from "./types.js";
//# sourceMappingURL=index.d.ts.map