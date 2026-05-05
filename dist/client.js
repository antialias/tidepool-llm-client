import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getConfiguredProviders, getProviderConfig, isProviderConfigured, loadConfigFromEnv, } from "./config.js";
import { Logger } from "./logger.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { OpenAIResponsesProvider } from "./providers/openai-responses.js";
import { executeWithRetry } from "./retry.js";
import { LLMApiError, ProviderNotConfiguredError } from "./types.js";
/**
 * Registry of provider factories
 */
const providerFactories = {
    openai: (config, name) => {
        const providerConfig = getProviderConfig(config, name);
        if (!providerConfig)
            throw new ProviderNotConfiguredError(name);
        return new OpenAIProvider(providerConfig);
    },
    anthropic: (config, name) => {
        const providerConfig = getProviderConfig(config, name);
        if (!providerConfig)
            throw new ProviderNotConfiguredError(name);
        return new AnthropicProvider(providerConfig);
    },
    // Gemini's OpenAI-compatible endpoint — same provider class, different base URL.
    gemini: (config, name) => {
        const providerConfig = getProviderConfig(config, name);
        if (!providerConfig)
            throw new ProviderNotConfiguredError(name);
        return new OpenAIProvider(providerConfig);
    },
};
/**
 * LLM Client for making type-safe LLM calls with multi-provider support
 *
 * Features:
 * - Multi-provider support (OpenAI, Anthropic, etc.)
 * - Zod schema validation for responses
 * - Zod .describe() annotations included in prompts for LLM context
 * - Retry logic with validation feedback
 * - Progress callbacks for UI updates
 *
 * @example
 * ```typescript
 * import { LLMClient } from '@tidepool/llm-client'
 * import { z } from 'zod'
 *
 * const llm = new LLMClient()
 *
 * const response = await llm.call({
 *   prompt: 'Extract sentiment from: "I love this!"',
 *   schema: z.object({
 *     sentiment: z.enum(['positive', 'negative', 'neutral'])
 *       .describe('The detected sentiment'),
 *     confidence: z.number()
 *       .describe('Confidence score between 0 and 1'),
 *   }).describe('Sentiment analysis result'),
 * })
 *
 * console.log(response.data.sentiment) // TypeScript knows this is valid
 * ```
 */
export class LLMClient {
    /**
     * Create a new LLM client
     *
     * @param configOverrides - Optional configuration overrides
     * @param env - Environment variables (defaults to process.env)
     * @param middleware - Internal: middleware stack (use .with() to add middleware)
     */
    constructor(configOverrides, env, middleware, requestDefaults) {
        this.providers = new Map();
        const envConfig = loadConfigFromEnv(env);
        this.config = {
            ...envConfig,
            ...configOverrides,
            providers: {
                ...envConfig.providers,
                ...configOverrides?.providers,
            },
            logging: configOverrides?.logging ?? envConfig.logging,
        };
        this.logger = new Logger(this.config.logging);
        this.middleware = middleware ?? [];
        this.requestDefaults = requestDefaults ?? {};
    }
    /**
     * Create a derived client with additional middleware.
     *
     * The new client shares the same configuration but has its own middleware stack.
     * Middleware is applied in order: first middleware wraps raw stream,
     * second wraps first's output, etc.
     *
     * @param middleware - Middleware to add to the new client
     * @returns A new LLMClient instance with the combined middleware
     *
     * @example
     * ```typescript
     * const base = new LLMClient()
     * const withPersistence = base.with(createPersistenceMiddleware({
     *   onReasoning: (text) => console.log('Reasoning:', text),
     *   onReasoningSnapshot: (text) => db.save({ reasoning: text }),
     * }))
     * ```
     */
    with(...middleware) {
        return new LLMClient(this.config, undefined, // env already loaded into config
        [...this.middleware, ...middleware], this.requestDefaults);
    }
    withRequestDefaults(defaults) {
        return new LLMClient(this.config, undefined, this.middleware, { ...this.requestDefaults, ...defaults });
    }
    /**
     * Enable or disable logging at runtime
     */
    setLogging(config) {
        const newConfig = { ...this.config.logging, ...config };
        this.config.logging = newConfig;
        this.logger = new Logger(newConfig);
    }
    /**
     * Make a structured LLM call with schema validation
     *
     * @param request - The request configuration
     * @returns Type-safe response with validated data
     */
    async call(request) {
        return this.executeRequest(request);
    }
    /**
     * Make a vision call (convenience method for requests with images)
     *
     * @param request - The request configuration (must include images)
     * @returns Type-safe response with validated data
     */
    async vision(request) {
        return this.executeRequest(request);
    }
    /**
     * Stream an LLM response with reasoning summaries
     *
     * Uses the OpenAI Responses API to stream responses with:
     * - Reasoning summaries (shows the model's thinking process)
     * - Output text deltas (partial response text)
     * - Final validated response
     *
     * @param request - The stream request configuration
     * @returns AsyncGenerator yielding stream events
     *
     * @example
     * ```typescript
     * const stream = llm.stream({
     *   prompt: 'Analyze this worksheet',
     *   images: [imageDataUrl],
     *   schema: WorksheetSchema,
     *   reasoning: { effort: 'medium', summary: 'auto' },
     * });
     *
     * for await (const event of stream) {
     *   if (event.type === 'reasoning') {
     *     console.log('Thinking:', event.text);
     *   } else if (event.type === 'complete') {
     *     console.log('Result:', event.data);
     *   }
     * }
     * ```
     */
    async *stream(request) {
        // Get raw stream from provider
        let stream = this.createRawStream(request);
        // Apply middleware chain
        for (const mw of this.middleware) {
            stream = mw.wrap(stream);
        }
        yield* stream;
    }
    /**
     * Create the raw provider stream without middleware
     */
    async *createRawStream(request) {
        // Get logger for this request (may be overridden by request.debug)
        const requestLogger = this.logger.withEnabled(request.debug);
        const providerName = request.provider ?? this.config.defaultProvider;
        const model = request.model ?? this.getDefaultModel(providerName);
        requestLogger.debug("Starting stream request", {
            provider: providerName,
            model,
            promptLength: request.prompt.length,
            hasImages: !!request.images?.length,
        });
        const isNativeOpenAI = providerName.toLowerCase() === "openai";
        // For non-OpenAI providers (Gemini, Anthropic), fall back to a
        // non-streaming call wrapped in a synthetic stream. These providers
        // don't support the OpenAI Responses API with reasoning params.
        if (!isNativeOpenAI) {
            requestLogger.debug("Non-OpenAI provider — using call() as stream fallback");
            const response = await this.executeRequest(request);
            yield { type: "started", responseId: "fallback" };
            yield {
                type: "output_delta",
                text: typeof response.data === 'object'
                    ? JSON.stringify(response.data)
                    : String(response.data),
                outputIndex: 0,
            };
            yield {
                type: "complete",
                data: response.data,
                usage: {
                    promptTokens: response.usage?.promptTokens ?? 0,
                    completionTokens: response.usage?.completionTokens ?? 0,
                    cachedInputTokens: response.usage?.cachedInputTokens,
                    reasoningTokens: response.usage?.reasoningTokens,
                },
                rawResponse: JSON.stringify(response.data),
            };
            return;
        }
        // Get provider config
        const providerConfig = getProviderConfig(this.config, providerName);
        if (!providerConfig) {
            throw new ProviderNotConfiguredError(providerName);
        }
        // Create responses provider (separate from chat completions provider)
        const responsesProvider = new OpenAIResponsesProvider(providerConfig, requestLogger);
        // Convert Zod schema to JSON Schema
        const jsonSchema = z.toJSONSchema(request.schema, {
            unrepresentable: "any",
        });
        // Default reasoning config for streaming (OpenAI only)
        const reasoning = request.reasoning ?? {
            effort: model.includes("5.2") && !model.includes("instant")
                ? "medium"
                : "low",
            summary: "auto",
        };
        requestLogger.debug("Streaming with config", {
            reasoning,
            timeoutMs: request.timeoutMs,
            schemaKeys: Object.keys(jsonSchema),
        });
        // Stream the response. Usage is recorded on the completion event because
        // Responses streaming reports token counts at the end of the stream.
        const startedAt = Date.now();
        let responseId = null;
        let streamErrorRecorded = false;
        const stream = responsesProvider.stream({
            prompt: request.prompt,
            images: request.images,
            jsonSchema,
            model,
            reasoning,
            timeoutMs: request.timeoutMs,
            forceReal: request.forceReal ?? this.requestDefaults.forceReal,
        }, request.schema);
        try {
            for await (const event of stream) {
                if (event.type === "started")
                    responseId = event.responseId;
                if (event.type === "complete") {
                    const forceReal = request.forceReal ?? this.requestDefaults.forceReal ?? null;
                    await this.recordUsageEvent({
                        usageContext: request.usageContext,
                        operation: "llm_stream",
                        status: "success",
                        provider: providerName,
                        model,
                        endpoint: "/responses",
                        forceReal,
                        providerResponseId: responseId,
                        durationMs: Date.now() - startedAt,
                        promptTokens: event.usage.promptTokens,
                        completionTokens: event.usage.completionTokens,
                        totalTokens: event.usage.promptTokens + event.usage.completionTokens,
                        cachedInputTokens: event.usage.cachedInputTokens,
                        reasoningTokens: event.usage.reasoningTokens,
                        rawUsage: event.usage,
                    });
                }
                if (event.type === "error") {
                    const forceReal = request.forceReal ?? this.requestDefaults.forceReal ?? null;
                    streamErrorRecorded = true;
                    await this.recordUsageEvent({
                        usageContext: request.usageContext,
                        operation: "llm_stream",
                        status: "error",
                        provider: providerName,
                        model,
                        endpoint: "/responses",
                        forceReal,
                        providerResponseId: responseId,
                        errorKind: event.code ?? null,
                        errorMessage: event.message,
                        durationMs: Date.now() - startedAt,
                    });
                }
                yield event;
            }
        }
        catch (error) {
            if (!streamErrorRecorded) {
                const forceReal = request.forceReal ?? this.requestDefaults.forceReal ?? null;
                await this.recordUsageEvent({
                    usageContext: request.usageContext,
                    operation: "llm_stream",
                    status: "error",
                    provider: providerName,
                    model,
                    endpoint: "/responses",
                    forceReal,
                    providerResponseId: responseId,
                    httpStatus: error instanceof LLMApiError ? error.statusCode : null,
                    errorKind: error instanceof Error ? error.name : null,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - startedAt,
                });
            }
            throw error;
        }
    }
    /**
     * Get list of configured providers
     */
    getProviders() {
        return getConfiguredProviders(this.config);
    }
    /**
     * Check if a provider is configured
     */
    isProviderAvailable(providerName) {
        return isProviderConfigured(this.config, providerName);
    }
    /**
     * Get the default provider name
     */
    getDefaultProvider() {
        return this.config.defaultProvider;
    }
    /**
     * Get the default model
     */
    getDefaultModel(providerName) {
        if (this.config.defaultModel) {
            return this.config.defaultModel;
        }
        const provider = getProviderConfig(this.config, providerName);
        return provider?.defaultModel ?? "default";
    }
    /**
     * Generate embeddings for text using OpenAI's embedding API
     *
     * @param request - The embedding request
     * @returns Embedding response with Float32Array embeddings
     *
     * @example
     * ```typescript
     * const llm = new LLMClient()
     *
     * // Single text
     * const { embeddings } = await llm.embed({ input: 'Hello world' })
     * console.log(embeddings[0]) // Float32Array(1536)
     *
     * // Multiple texts (more efficient)
     * const { embeddings } = await llm.embed({
     *   input: ['Hello', 'World'],
     *   model: 'text-embedding-3-small'
     * })
     * ```
     */
    async embed(request) {
        // Embeddings are only available via OpenAI
        const providerConfig = getProviderConfig(this.config, "openai");
        if (!providerConfig) {
            throw new ProviderNotConfiguredError("openai");
        }
        const model = request.model ?? "text-embedding-3-small";
        const inputTexts = Array.isArray(request.input)
            ? request.input
            : [request.input];
        const requestBody = {
            model,
            input: inputTexts,
        };
        if (request.dimensions) {
            requestBody.dimensions = request.dimensions;
        }
        const startedAt = Date.now();
        const endpoint = "/embeddings";
        const response = await fetch(`${providerConfig.baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${providerConfig.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message ?? errorText;
            }
            catch {
                // Keep original text
            }
            await this.recordUsageEvent({
                usageContext: request.usageContext,
                operation: "embedding",
                status: "error",
                provider: "openai",
                model,
                endpoint,
                httpStatus: response.status,
                errorMessage,
                durationMs: Date.now() - startedAt,
            });
            throw new LLMApiError("openai", response.status, errorMessage);
        }
        const data = (await response.json());
        // Sort by index to ensure correct order
        const sortedData = data.data.sort((a, b) => a.index - b.index);
        // Convert to Float32Arrays
        const embeddings = sortedData.map((item) => new Float32Array(item.embedding));
        await this.recordUsageEvent({
            usageContext: request.usageContext,
            operation: "embedding",
            status: "success",
            provider: "openai",
            model: data.model,
            endpoint,
            promptTokens: data.usage.prompt_tokens,
            totalTokens: data.usage.total_tokens,
            durationMs: Date.now() - startedAt,
            rawUsage: data.usage,
        });
        return {
            embeddings,
            usage: {
                promptTokens: data.usage.prompt_tokens,
                totalTokens: data.usage.total_tokens,
            },
            model: data.model,
        };
    }
    /**
     * Execute the LLM request with retry logic
     */
    async executeRequest(request) {
        const providerName = request.provider ?? this.config.defaultProvider;
        const model = request.model ?? this.getDefaultModel(providerName);
        const maxRetries = request.maxRetries ?? this.config.defaultMaxRetries;
        // Get or create provider instance
        const provider = this.getOrCreateProvider(providerName);
        // Convert Zod schema to JSON Schema using Zod v4's native method
        // This preserves .describe() annotations as "description" fields
        const jsonSchema = z.toJSONSchema(request.schema, {
            unrepresentable: "any", // Convert unrepresentable types to {} instead of throwing
        });
        // Only add reasoning_effort for native OpenAI models that support it.
        // Gemini's OpenAI-compatible endpoint does not support this parameter.
        const isNativeOpenAI = providerName === "openai";
        const reasoningEffort = isNativeOpenAI
            ? request.reasoningEffort ??
                (model.includes("5.2") && !model.includes("instant")
                    ? "medium"
                    : undefined)
            : undefined;
        // Timeout for LLM requests (default 2 minutes)
        const timeoutMs = request.timeoutMs ?? 120000;
        const retryGroupId = createId();
        let providerAttempt = 0;
        // Execute with retry logic
        const { result: providerResponse, attempts } = await executeWithRetry(async (validationFeedback) => {
            providerAttempt += 1;
            const attempt = providerAttempt;
            const startedAt = Date.now();
            const providerRequest = {
                prompt: request.prompt,
                images: request.images,
                jsonSchema,
                model,
                validationFeedback,
                reasoningEffort,
                timeoutMs,
                forceReal: request.forceReal ?? this.requestDefaults.forceReal,
            };
            try {
                const response = await provider.call(providerRequest);
                const forceReal = request.forceReal ?? this.requestDefaults.forceReal ?? null;
                await this.recordUsageEvent({
                    usageContext: request.usageContext,
                    operation: "llm_call",
                    status: "success",
                    provider: providerName,
                    model,
                    endpoint: providerName.toLowerCase() === "anthropic" ? "/messages" : "/chat/completions",
                    retryGroupId,
                    attempt,
                    forceReal,
                    providerResponseId: response.responseId,
                    durationMs: Date.now() - startedAt,
                    promptTokens: response.usage.promptTokens,
                    completionTokens: response.usage.completionTokens,
                    totalTokens: response.usage.promptTokens + response.usage.completionTokens,
                    cachedInputTokens: response.usage.cachedInputTokens,
                    reasoningTokens: response.usage.reasoningTokens,
                    rawUsage: response.usage,
                });
                return response;
            }
            catch (error) {
                const forceReal = request.forceReal ?? this.requestDefaults.forceReal ?? null;
                await this.recordUsageEvent({
                    usageContext: request.usageContext,
                    operation: "llm_call",
                    status: "error",
                    provider: providerName,
                    model,
                    endpoint: providerName.toLowerCase() === "anthropic" ? "/messages" : "/chat/completions",
                    retryGroupId,
                    attempt,
                    forceReal,
                    httpStatus: error instanceof LLMApiError ? error.statusCode : null,
                    errorKind: error instanceof LLMApiError ? error.name : null,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - startedAt,
                });
                throw error;
            }
        }, (response) => {
            // Validate response against schema
            const parseResult = request.schema.safeParse(response.content);
            if (!parseResult.success) {
                // Extract first error for feedback (Zod v4 uses 'issues')
                const firstIssue = parseResult.error.issues[0];
                if (firstIssue) {
                    return {
                        field: firstIssue.path.join(".") || "root",
                        error: firstIssue.message,
                        received: response.content,
                    };
                }
                return {
                    field: "root",
                    error: "Validation failed",
                    received: response.content,
                };
            }
            return null; // Valid
        }, {
            maxRetries,
            onProgress: request.onProgress,
        });
        // Parse the validated response
        const parseResult = request.schema.safeParse(providerResponse.content);
        if (!parseResult.success) {
            // Should not happen after retry validation, but handle gracefully
            throw new Error("Validation failed after retry");
        }
        return {
            data: parseResult.data,
            usage: {
                promptTokens: providerResponse.usage.promptTokens,
                completionTokens: providerResponse.usage.completionTokens,
                totalTokens: providerResponse.usage.promptTokens +
                    providerResponse.usage.completionTokens,
                cachedInputTokens: providerResponse.usage.cachedInputTokens,
                reasoningTokens: providerResponse.usage.reasoningTokens,
            },
            attempts,
            provider: providerName,
            model,
            rawResponse: providerResponse.rawContent,
            jsonSchema: JSON.stringify(jsonSchema, null, 2),
        };
    }
    /**
     * Get or create a provider instance
     */
    getOrCreateProvider(providerName) {
        const name = providerName.toLowerCase();
        // Check cache
        const cached = this.providers.get(name);
        if (cached) {
            return cached;
        }
        // Check if provider is configured
        if (!isProviderConfigured(this.config, name)) {
            throw new ProviderNotConfiguredError(name);
        }
        // Get factory
        const factory = providerFactories[name];
        if (!factory) {
            throw new Error(`Unknown provider: ${name}. Supported providers: ${Object.keys(providerFactories).join(", ")}`);
        }
        // Create and cache provider
        const provider = factory(this.config, name);
        this.providers.set(name, provider);
        return provider;
    }
    async recordUsageEvent(event) {
        await this.config.usageRecorder?.(event);
    }
}
