import type { z } from "zod";
/**
 * Log levels for LLM client logging
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
/**
 * Logger function signature
 * @param level - The log level
 * @param message - The log message
 * @param data - Optional structured data to include
 */
export type LoggerFn = (level: LogLevel, message: string, data?: Record<string, unknown>) => void;
/**
 * Logging configuration for the LLM client
 */
export interface LoggingConfig {
    /** Enable logging globally (default: false) */
    enabled: boolean;
    /** Custom logger function (default: console-based logger) */
    logger?: LoggerFn | undefined;
    /** Minimum log level to output (default: 'debug') */
    minLevel?: LogLevel | undefined;
}
/**
 * Default console-based logger
 */
export declare const defaultLogger: LoggerFn;
/**
 * Provider configuration loaded from environment variables
 */
export interface ProviderConfig {
    /** Provider name (e.g., 'openai', 'anthropic') */
    name: string;
    /** API key for authentication */
    apiKey: string;
    /** Base URL for API requests */
    baseUrl: string;
    /** Default model for this provider */
    defaultModel: string;
    /** Provider-specific options */
    options?: Record<string, unknown> | undefined;
    /**
     * Optional app-provided base URL override. This lets an application route
     * debug/local traffic without the package importing application modules.
     */
    baseUrlOverride?: ProviderBaseUrlOverride | undefined;
    /**
     * Maximum number of images this provider can generate in a single API call.
     * When `n` on an image-edit request exceeds this limit, the client
     * automatically loops `n` times with `n = maxImagesPerCall` per call, running
     * each sub-call through the full middleware + recording path independently.
     * `undefined` means unlimited (provider handles `n` natively).
     */
    maxImagesPerCall?: number | undefined;
}
export interface ProviderBaseUrlOverrideInput {
    provider: string;
    endpoint: string;
    model: string;
    forceReal?: boolean | undefined;
}
export type ProviderBaseUrlOverride = (input: ProviderBaseUrlOverrideInput) => string | null | undefined | Promise<string | null | undefined>;
/**
 * LLM client configuration
 */
export interface LLMClientConfig<TUsageContext extends object = object> {
    /** Default provider to use */
    defaultProvider: string;
    /** Default model (overrides provider default) */
    defaultModel?: string | undefined;
    /** Configured providers */
    providers: Record<string, ProviderConfig>;
    /** Default maximum retry attempts */
    defaultMaxRetries: number;
    /** Logging configuration */
    logging?: LoggingConfig | undefined;
    /** Optional app-provided usage recorder. */
    usageRecorder?: LLMUsageRecorder<TUsageContext> | undefined;
}
export type LLMOperation = "llm_call" | "llm_stream" | "embedding" | "image_edit";
export type LLMUsageStatus = "success" | "error";
export interface LLMUsageEvent<TUsageContext extends object = object> {
    usageContext?: TUsageContext | undefined;
    operation: LLMOperation;
    status: LLMUsageStatus;
    provider: string;
    model: string;
    endpoint?: string | null | undefined;
    retryGroupId?: string | null | undefined;
    attempt?: number | null | undefined;
    forceReal?: boolean | null | undefined;
    providerResponseId?: string | null | undefined;
    httpStatus?: number | null | undefined;
    errorKind?: string | null | undefined;
    errorMessage?: string | null | undefined;
    durationMs?: number | null | undefined;
    promptTokens?: number | null | undefined;
    completionTokens?: number | null | undefined;
    totalTokens?: number | null | undefined;
    cachedInputTokens?: number | null | undefined;
    reasoningTokens?: number | null | undefined;
    rawUsage?: object | null | undefined;
}
export type LLMUsageRecorder<TUsageContext extends object = object> = (event: LLMUsageEvent<TUsageContext>) => void | Promise<void>;
/**
 * Reasoning effort levels for GPT-5.2+ models
 * Controls depth of reasoning (more = better quality, higher latency/cost)
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
/**
 * Request to make an LLM call with type-safe schema validation
 */
export interface LLMRequest<T extends z.ZodType, TUsageContext extends object = object> {
    /** The prompt to send to the LLM */
    prompt: string;
    /** Base64 data URLs for vision requests */
    images?: string[] | undefined;
    /** Zod schema for response validation */
    schema: T;
    /** Override default provider */
    provider?: string | undefined;
    /** Override default model */
    model?: string | undefined;
    /** Maximum retry attempts (default: 2) */
    maxRetries?: number | undefined;
    /** Progress callback for UI feedback */
    onProgress?: ((progress: LLMProgress) => void) | undefined;
    /**
     * Reasoning effort for GPT-5.2+ models (default: 'medium' for thinking models)
     * Higher values = better reasoning but more tokens/latency
     */
    reasoningEffort?: ReasoningEffort | undefined;
    /**
     * Request timeout in milliseconds (default: 120000 = 2 minutes)
     * Set to 0 for no timeout (not recommended)
     */
    timeoutMs?: number | undefined;
    /** Bypass mock/local debug routing for this request. */
    forceReal?: boolean | undefined;
    /** Additional metadata stored with the AI usage ledger row. */
    usageContext?: TUsageContext | undefined;
}
/**
 * Progress updates during LLM call
 */
export interface LLMProgress {
    /** Current stage of the call */
    stage: "preparing" | "calling" | "validating" | "retrying";
    /** Current attempt number (1-indexed) */
    attempt: number;
    /** Maximum number of attempts */
    maxAttempts: number;
    /** Human-readable status message */
    message: string;
    /** Validation error from previous attempt (for retries) */
    validationError?: ValidationFeedback | undefined;
}
/**
 * Validation error feedback for retry prompts
 */
export interface ValidationFeedback {
    /** Field path that failed validation */
    field: string;
    /** Error description */
    error: string;
    /** Value that was received */
    received?: unknown;
    /** Expected value or type */
    expected?: unknown;
    /** Valid options (for enum fields) */
    validOptions?: string[] | undefined;
}
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens?: number | undefined;
    reasoningTokens?: number | undefined;
}
/**
 * Response from an LLM call
 */
export interface LLMResponse<T> {
    /** Validated response data (typed according to schema) */
    data: T;
    /** Token usage statistics */
    usage: TokenUsage;
    /** Number of attempts needed */
    attempts: number;
    /** Provider that was used */
    provider: string;
    /** Model that was used */
    model: string;
    /** Raw JSON response from the LLM (before parsing/validation) */
    rawResponse: string;
    /** JSON Schema sent to the LLM (with field-level descriptions from .describe()) */
    jsonSchema: string;
}
/**
 * Internal request passed to providers
 */
export interface ProviderRequest {
    /** The prompt to send */
    prompt: string;
    /** Base64 data URLs for vision */
    images?: string[] | undefined;
    /** JSON schema for structured output */
    jsonSchema: Record<string, unknown>;
    /** Model to use */
    model: string;
    /** Validation feedback from previous attempt */
    validationFeedback?: ValidationFeedback | undefined;
    /** Reasoning effort level (for GPT-5.2+ models) */
    reasoningEffort?: ReasoningEffort | undefined;
    /** Request timeout in milliseconds */
    timeoutMs?: number | undefined;
    /** Provider sampling temperature, when supported */
    temperature?: number | undefined;
    /** Bypass mock/local debug routing for this request. */
    forceReal?: boolean | undefined;
}
/**
 * Internal response from providers
 */
export interface ProviderResponse {
    /** Parsed content from the LLM */
    content: unknown;
    /** Raw JSON string from the LLM (before parsing) */
    rawContent: string;
    /** Token usage */
    usage: {
        promptTokens: number;
        completionTokens: number;
        cachedInputTokens?: number | undefined;
        reasoningTokens?: number | undefined;
    };
    /** Finish reason */
    finishReason: string;
    /** Provider response id, when present. */
    responseId?: string | undefined;
}
/**
 * LLM Provider interface for implementing different providers
 */
export interface LLMProvider {
    /** Provider name */
    readonly name: string;
    /** Make an LLM call */
    call(request: ProviderRequest): Promise<ProviderResponse>;
}
/**
 * Error thrown when LLM validation fails after all retries
 */
export declare class LLMValidationError extends Error {
    readonly feedback: ValidationFeedback;
    constructor(feedback: ValidationFeedback);
}
/**
 * Error thrown when provider is not configured
 */
export declare class ProviderNotConfiguredError extends Error {
    constructor(provider: string);
}
/**
 * Error thrown when LLM API call fails
 */
export declare class LLMApiError extends Error {
    readonly provider: string;
    readonly statusCode: number;
    readonly retryAfterMs?: number | undefined;
    constructor(provider: string, statusCode: number, message: string, retryAfterMs?: number | undefined);
    /** Check if this is a rate limit error */
    isRateLimited(): boolean;
    /** Check if this is a server error that may be transient */
    isServerError(): boolean;
    /** Check if this is a client error that won't be fixed by retrying */
    isClientError(): boolean;
}
/**
 * Error thrown when LLM response is truncated due to token limits
 */
export declare class LLMTruncationError extends Error {
    readonly provider: string;
    readonly partialContent: unknown;
    constructor(provider: string, partialContent: unknown);
}
/**
 * Error thrown when LLM refuses to respond due to content filter
 */
export declare class LLMContentFilterError extends Error {
    readonly provider: string;
    readonly filterReason?: string | undefined;
    constructor(provider: string, filterReason?: string | undefined);
}
/**
 * Error thrown when JSON parsing fails
 */
export declare class LLMJsonParseError extends Error {
    readonly rawContent: string;
    readonly parseError: string;
    constructor(rawContent: string, parseError: string);
}
/**
 * Error thrown when LLM request times out
 */
export declare class LLMTimeoutError extends Error {
    readonly provider: string;
    readonly timeoutMs: number;
    constructor(provider: string, timeoutMs: number);
}
/**
 * Error thrown when network connection fails
 */
export declare class LLMNetworkError extends Error {
    readonly provider: string;
    readonly cause?: Error | undefined;
    constructor(provider: string, cause?: Error | undefined);
}
/**
 * Configuration for reasoning in streaming requests
 */
export interface ReasoningConfig {
    /** How much reasoning effort to apply */
    effort: ReasoningEffort;
    /** Whether to include reasoning summaries ("auto" = detailed summaries) */
    summary?: "auto" | "concise" | "detailed" | undefined;
}
/**
 * Request for streaming LLM call
 */
export interface LLMStreamRequest<T extends z.ZodType, TUsageContext extends object = object> {
    /** The prompt to send to the LLM */
    prompt: string;
    /** Base64 data URLs for vision requests */
    images?: string[] | undefined;
    /** Zod schema for response validation */
    schema: T;
    /** Override default provider */
    provider?: string | undefined;
    /** Override default model */
    model?: string | undefined;
    /** Reasoning configuration (enables reasoning summaries when set) */
    reasoning?: ReasoningConfig | undefined;
    /**
     * Request timeout in milliseconds (default: 300000 = 5 minutes for streaming)
     * Streaming requests typically take longer, so default is higher
     */
    timeoutMs?: number | undefined;
    /**
     * Enable debug logging for this request (overrides global setting)
     * Set to true to enable, false to disable, or omit to use global setting
     */
    debug?: boolean | undefined;
    /** Bypass mock/local debug routing for this request. */
    forceReal?: boolean | undefined;
    /** Additional metadata stored with the AI usage ledger row. */
    usageContext?: TUsageContext | undefined;
}
/**
 * Base streaming event
 */
interface StreamEventBase {
    /** Sequence number for ordering */
    sequence?: number | undefined;
}
/**
 * Event when stream starts
 */
export interface StreamEventStarted extends StreamEventBase {
    type: "started";
    /** Response ID from the API */
    responseId: string;
}
/**
 * Event for reasoning summary text (the "thinking" process)
 */
export interface StreamEventReasoning extends StreamEventBase {
    type: "reasoning";
    /** The reasoning summary text */
    text: string;
    /** Index of the summary part (for multi-step reasoning) */
    summaryIndex: number;
    /** Whether this is a delta (partial) or complete text */
    isDelta: boolean;
}
/**
 * Event for output text delta
 */
export interface StreamEventOutputDelta extends StreamEventBase {
    type: "output_delta";
    /** The partial output text */
    text: string;
    /** Index of the output item */
    outputIndex: number;
}
/**
 * Event when an error occurs during streaming
 */
export interface StreamEventError extends StreamEventBase {
    type: "error";
    /** Error message */
    message: string;
    /** Error code if available */
    code?: string | undefined;
}
/**
 * Event when streaming completes successfully
 */
export interface StreamEventComplete<T> extends StreamEventBase {
    type: "complete";
    /** The validated response data */
    data: T;
    /** Token usage statistics */
    usage: {
        promptTokens: number;
        completionTokens: number;
        cachedInputTokens?: number | undefined;
        reasoningTokens?: number | undefined;
    };
    /** Raw JSON response */
    rawResponse: string;
}
/**
 * Union of all streaming event types
 */
export type StreamEvent<T> = StreamEventStarted | StreamEventReasoning | StreamEventOutputDelta | StreamEventError | StreamEventComplete<T>;
/**
 * Request for embedding generation
 */
export interface EmbeddingRequest<TUsageContext extends object = object> {
    /** Text or array of texts to embed */
    input: string | string[];
    /** Model to use (default: text-embedding-3-small) */
    model?: string | undefined;
    /** Number of dimensions to return (optional, for models that support it) */
    dimensions?: number | undefined;
    /** Additional metadata stored with the AI usage ledger row. */
    usageContext?: TUsageContext | undefined;
}
/**
 * Response from embedding generation
 */
export interface EmbeddingResponse {
    /** Array of embeddings (one per input text) */
    embeddings: Float32Array[];
    /** Token usage statistics */
    usage: {
        promptTokens: number;
        totalTokens: number;
    };
    /** Model that was used */
    model: string;
}
export {};
//# sourceMappingURL=types.d.ts.map