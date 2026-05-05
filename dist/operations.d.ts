import type { z } from "zod";
import type { ProviderRequest, ProviderResponse, ReasoningConfig, ReasoningEffort, StreamEvent, TokenUsage, ValidationFeedback } from "./types.js";
import type { AiErrorKind, AiResolutionSource } from "./errors.js";
export type AiOperationKind = "text-object" | "text" | "text-stream" | "embedding" | "image-edit";
export type AiCapability = "jsonSchema" | "text" | "streaming" | "embeddings" | "vision" | "reasoning" | "longContext" | "imageEdit" | "references";
export type AiModelReference = `${string}/${string}` | {
    provider: string;
    model: string;
};
export interface ParsedAiModelReference {
    provider?: string | undefined;
    model: string;
}
export interface ResolvedAiModel {
    provider: string;
    model: string;
    source: AiResolutionSource;
}
export type AiMessageRole = "system" | "user" | "assistant";
export interface AiMessage {
    role: AiMessageRole;
    content: string;
}
export interface AiRetryPolicy {
    /**
     * Number of retries after the first attempt. The DSL default is 0.
     */
    attempts: number;
    /**
     * AiError kinds eligible for retry.
     */
    on: readonly AiErrorKind[];
    /**
     * Optional per-retry delays in milliseconds. Missing entries default to 0.
     */
    backoffMs?: readonly number[] | undefined;
}
export type AiFallbackPolicy = {
    mode: "none";
} | {
    mode: "ordered";
    candidates: readonly AiModelReference[];
    on: readonly AiErrorKind[];
};
export interface AiRequestBase<TUsageContext extends object = object> {
    intent?: string | undefined;
    callSite?: string | undefined;
    prompt?: string | undefined;
    messages?: readonly AiMessage[] | undefined;
    provider?: string | undefined;
    model?: string | AiModelReference | undefined;
    retry?: AiRetryPolicy | undefined;
    fallbackPolicy?: AiFallbackPolicy | undefined;
    timeoutMs?: number | undefined;
    temperature?: number | undefined;
    forceReal?: boolean | undefined;
    usageContext?: TUsageContext | undefined;
}
export interface AiObjectRequest<TSchema extends z.ZodType, TUsageContext extends object = object> extends AiRequestBase<TUsageContext> {
    schema: TSchema;
    images?: readonly string[] | undefined;
    reasoningEffort?: ReasoningEffort | undefined;
}
export interface AiTextRequest<TUsageContext extends object = object> extends AiRequestBase<TUsageContext> {
    images?: readonly string[] | undefined;
    reasoningEffort?: ReasoningEffort | undefined;
}
export interface AiStreamObjectRequest<TSchema extends z.ZodType, TUsageContext extends object = object> extends AiRequestBase<TUsageContext> {
    schema: TSchema;
    images?: readonly string[] | undefined;
    reasoning?: ReasoningConfig | undefined;
}
export interface AiEmbedRequest<TUsageContext extends object = object> extends AiRequestBase<TUsageContext> {
    input: string | readonly string[];
    dimensions?: number | undefined;
}
export interface AiImageEditRequest<TUsageContext extends object = object> extends AiRequestBase<TUsageContext> {
    referenceImages: readonly string[];
    size?: string | undefined;
    n?: number | undefined;
    quality?: "low" | "medium" | "high" | undefined;
}
export interface AiAttempt {
    attempt: number;
    provider: string;
    model: string;
    isFallback: boolean;
}
export interface AiResultBase<TUsageContext extends object = object> {
    usageContext?: TUsageContext | undefined;
    provider: string;
    model: string;
    intent?: string | undefined;
    callSite?: string | undefined;
    attempts: readonly AiAttempt[];
}
export interface AiObjectResult<TOutput, TUsageContext extends object = object> extends AiResultBase<TUsageContext> {
    operation: "text-object";
    output: TOutput;
    usage: TokenUsage;
    rawResponse: string;
    jsonSchema: string;
}
export interface AiTextResult<TUsageContext extends object = object> extends AiResultBase<TUsageContext> {
    operation: "text";
    output: string;
    usage: TokenUsage;
    rawResponse: string;
    jsonSchema: string;
}
export interface AiStreamObjectResult<TOutput, TUsageContext extends object = object> extends AiResultBase<TUsageContext> {
    operation: "text-stream";
    stream: AsyncGenerator<StreamEvent<TOutput>, void, unknown>;
}
export interface AiEmbedResult<TUsageContext extends object = object> extends AiResultBase<TUsageContext> {
    operation: "embedding";
    embeddings: readonly Float32Array[];
    usage: {
        promptTokens: number;
        totalTokens: number;
    };
}
export interface AiImageEditResult<TUsageContext extends object = object> extends AiResultBase<TUsageContext> {
    operation: "image-edit";
    images: readonly string[];
    usage: AiImageUsage;
}
export interface AiImageUsage {
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
    totalTokens?: number | undefined;
    imageInputTokens?: number | undefined;
    imageOutputTokens?: number | undefined;
    raw?: unknown;
}
export type AiOperationEnvelope<TUsageContext extends object = object> = AiObjectOperationEnvelope<z.ZodType, TUsageContext> | AiTextOperationEnvelope<TUsageContext> | AiStreamObjectOperationEnvelope<z.ZodType, TUsageContext> | AiEmbedOperationEnvelope<TUsageContext> | AiImageEditOperationEnvelope<TUsageContext>;
export interface AiOperationEnvelopeBase<TKind extends AiOperationKind, TUsageContext extends object = object> {
    operation: TKind;
    intent?: string | undefined;
    callSite?: string | undefined;
    resolvedModel: ResolvedAiModel;
    retry: AiRetryPolicy;
    fallbackPolicy: AiFallbackPolicy;
    retryGroupId: string;
    usageContext?: TUsageContext | undefined;
    providerRequest?: ProviderRequest | undefined;
}
export interface AiObjectOperationEnvelope<TSchema extends z.ZodType, TUsageContext extends object = object> extends AiOperationEnvelopeBase<"text-object", TUsageContext> {
    request: AiObjectRequest<TSchema, TUsageContext>;
    jsonSchema: Record<string, unknown>;
    prompt: string;
    validationFeedback?: ValidationFeedback | undefined;
}
export interface AiTextOperationEnvelope<TUsageContext extends object = object> extends AiOperationEnvelopeBase<"text", TUsageContext> {
    request: AiTextRequest<TUsageContext>;
    jsonSchema: Record<string, unknown>;
    prompt: string;
    validationFeedback?: ValidationFeedback | undefined;
}
export interface AiStreamObjectOperationEnvelope<TSchema extends z.ZodType, TUsageContext extends object = object> extends AiOperationEnvelopeBase<"text-stream", TUsageContext> {
    request: AiStreamObjectRequest<TSchema, TUsageContext>;
    jsonSchema: Record<string, unknown>;
    prompt: string;
}
export interface AiEmbedOperationEnvelope<TUsageContext extends object = object> extends AiOperationEnvelopeBase<"embedding", TUsageContext> {
    request: AiEmbedRequest<TUsageContext>;
}
export interface AiImageEditOperationEnvelope<TUsageContext extends object = object> extends AiOperationEnvelopeBase<"image-edit", TUsageContext> {
    request: AiImageEditRequest<TUsageContext>;
}
export type AiOperationResult<TOperation extends AiOperationEnvelope> = TOperation extends AiObjectOperationEnvelope<infer TSchema, infer TUsageContext> ? AiObjectResult<z.infer<TSchema>, TUsageContext> : TOperation extends AiTextOperationEnvelope<infer TUsageContext> ? AiTextResult<TUsageContext> : TOperation extends AiStreamObjectOperationEnvelope<infer TSchema, infer TUsageContext> ? AiStreamObjectResult<z.infer<TSchema>, TUsageContext> : TOperation extends AiEmbedOperationEnvelope<infer TUsageContext> ? AiEmbedResult<TUsageContext> : TOperation extends AiImageEditOperationEnvelope<infer TUsageContext> ? AiImageEditResult<TUsageContext> : never;
export interface AiProviderEmbeddingRequest {
    input: readonly string[];
    model: string;
    dimensions?: number | undefined;
    forceReal?: boolean | undefined;
}
export interface AiProviderEmbeddingResponse {
    embeddings: readonly Float32Array[];
    usage: {
        promptTokens: number;
        totalTokens: number;
    };
    model: string;
}
export interface AiEmbeddingProvider {
    embed(request: AiProviderEmbeddingRequest): Promise<AiProviderEmbeddingResponse>;
}
export interface AiProviderImageEditRequest {
    prompt: string;
    referenceImages: readonly string[];
    model: string;
    size?: string | undefined;
    n?: number | undefined;
    quality?: "low" | "medium" | "high" | undefined;
    forceReal?: boolean | undefined;
}
export interface AiProviderImageEditResponse {
    images: readonly string[];
    usage: AiImageUsage;
    model: string;
    responseId?: string | undefined;
}
export interface AiImageProvider {
    imageEdit(request: AiProviderImageEditRequest): Promise<AiProviderImageEditResponse>;
}
export interface AiProviderStreamObjectRequest {
    prompt: string;
    images?: readonly string[] | undefined;
    jsonSchema: Record<string, unknown>;
    model: string;
    reasoning?: ReasoningConfig | undefined;
    timeoutMs?: number | undefined;
    forceReal?: boolean | undefined;
    temperature?: number | undefined;
}
export interface AiStreamingProvider {
    streamObject<TSchema extends z.ZodType>(request: AiProviderStreamObjectRequest, schema: TSchema): AsyncGenerator<StreamEvent<z.infer<TSchema>>, void, unknown>;
}
export interface AiProviderCallSuccess {
    response: ProviderResponse;
    validationFeedback?: undefined;
}
export interface AiProviderCallValidationFailure {
    response: ProviderResponse;
    validationFeedback: ValidationFeedback;
}
export type AiProviderCallOutcome = AiProviderCallSuccess | AiProviderCallValidationFailure;
export declare const DEFAULT_AI_RETRY_POLICY: AiRetryPolicy;
export declare const DEFAULT_AI_FALLBACK_POLICY: AiFallbackPolicy;
export declare function parseAiModelReference(reference: string | AiModelReference): ParsedAiModelReference;
//# sourceMappingURL=operations.d.ts.map