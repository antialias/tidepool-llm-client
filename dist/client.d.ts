import { z } from "zod";
import type { StreamMiddleware } from "./middleware.js";
import type { EmbeddingRequest, EmbeddingResponse, LLMClientConfig, LLMRequest, LLMResponse, LLMStreamRequest, LoggingConfig, StreamEvent } from "./types.js";
interface RequestDefaults {
    forceReal?: boolean;
}
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
export declare class LLMClient<TUsageContext extends object = object> {
    private readonly config;
    private readonly providers;
    private readonly middleware;
    private readonly requestDefaults;
    private logger;
    /**
     * Create a new LLM client
     *
     * @param configOverrides - Optional configuration overrides
     * @param env - Environment variables (defaults to process.env)
     * @param middleware - Internal: middleware stack (use .with() to add middleware)
     */
    constructor(configOverrides?: Partial<LLMClientConfig<TUsageContext>>, env?: Record<string, string | undefined>, middleware?: StreamMiddleware[], requestDefaults?: RequestDefaults);
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
    with(...middleware: StreamMiddleware[]): LLMClient<TUsageContext>;
    withRequestDefaults(defaults: RequestDefaults): LLMClient<TUsageContext>;
    /**
     * Enable or disable logging at runtime
     */
    setLogging(config: Partial<LoggingConfig>): void;
    /**
     * Make a structured LLM call with schema validation
     *
     * @param request - The request configuration
     * @returns Type-safe response with validated data
     */
    call<T extends z.ZodType>(request: LLMRequest<T, TUsageContext>): Promise<LLMResponse<z.infer<T>>>;
    /**
     * Make a vision call (convenience method for requests with images)
     *
     * @param request - The request configuration (must include images)
     * @returns Type-safe response with validated data
     */
    vision<T extends z.ZodType>(request: LLMRequest<T, TUsageContext> & {
        images: string[];
    }): Promise<LLMResponse<z.infer<T>>>;
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
    stream<T extends z.ZodType>(request: LLMStreamRequest<T, TUsageContext>): AsyncGenerator<StreamEvent<z.infer<T>>, void, unknown>;
    /**
     * Create the raw provider stream without middleware
     */
    private createRawStream;
    /**
     * Get list of configured providers
     */
    getProviders(): string[];
    /**
     * Check if a provider is configured
     */
    isProviderAvailable(providerName: string): boolean;
    /**
     * Get the default provider name
     */
    getDefaultProvider(): string;
    /**
     * Get the default model
     */
    getDefaultModel(providerName?: string): string;
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
    embed(request: EmbeddingRequest<TUsageContext>): Promise<EmbeddingResponse>;
    /**
     * Execute the LLM request with retry logic
     */
    private executeRequest;
    /**
     * Get or create a provider instance
     */
    private getOrCreateProvider;
    private recordUsageEvent;
}
export {};
//# sourceMappingURL=client.d.ts.map