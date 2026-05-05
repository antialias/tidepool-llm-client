import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import type { ProviderConcurrencyRegistry } from "./concurrency.js";
import { getProviderConfig, isProviderConfigured } from "./config.js";
import { AiError, toAiError } from "./errors.js";
import type { AiErrorContext, AiErrorKind } from "./errors.js";
import type {
  AiIntentName,
  AiIntentRegistrySpec,
  AiIntentSpec,
} from "./intent-registry.js";
import type {
  AiClientScope,
  AiFallbackDecision,
  AiHooks,
  AiMiddleware,
  AiPlugin,
} from "./plugins.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import type {
  AiAttempt,
  AiEmbedOperationEnvelope,
  AiEmbedRequest,
  AiEmbedResult,
  AiEmbeddingProvider,
  AiCapability,
  AiFallbackPolicy,
  AiImageEditOperationEnvelope,
  AiImageEditRequest,
  AiImageEditResult,
  AiImageProvider,
  AiMessage,
  AiModelReference,
  AiObjectOperationEnvelope,
  AiObjectRequest,
  AiObjectResult,
  AiOperationEnvelope,
  AiOperationKind,
  AiOperationResult,
  AiProviderEmbeddingRequest,
  AiProviderImageEditRequest,
  AiRetryPolicy,
  AiStreamingProvider,
  AiStreamObjectOperationEnvelope,
  AiStreamObjectRequest,
  AiStreamObjectResult,
  AiTextOperationEnvelope,
  AiTextRequest,
  AiTextResult,
  ResolvedAiModel,
} from "./operations.js";
import {
  DEFAULT_AI_FALLBACK_POLICY,
  DEFAULT_AI_RETRY_POLICY,
  parseAiModelReference,
} from "./operations.js";
import type {
  LLMProvider,
  LLMUsageEvent,
  LLMUsageRecorder,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  StreamEvent,
  TokenUsage,
  ValidationFeedback,
} from "./types.js";
import {
  LLMApiError,
  ProviderNotConfiguredError,
} from "./types.js";
import { OpenAIDslProvider } from "./providers/openai-dsl.js";

export interface AiProviderFactoryInput {
  providerName: string;
  providerConfig: ProviderConfig;
}

export type AiProviderInstance = LLMProvider &
  Partial<AiEmbeddingProvider> &
  Partial<AiStreamingProvider> &
  Partial<AiImageProvider>;

export type AiProviderFactory = (
  input: AiProviderFactoryInput,
) => AiProviderInstance;

export interface AiClientConfig<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
> {
  registry: TRegistry;
  providers: Record<string, ProviderConfig>;
  defaultProvider?: string | undefined;
  defaultModel?: string | undefined;
  providerFactories?: Partial<Record<string, AiProviderFactory>> | undefined;
  plugins?: readonly AiPlugin<TRegistry, TUsageContext>[] | undefined;
  hooks?: AiHooks<TRegistry, TUsageContext> | undefined;
  usageRecorder?: LLMUsageRecorder<TUsageContext> | undefined;
  concurrency?: ProviderConcurrencyRegistry | undefined;
}

export type AiClientScopeInput<TUsageContext extends object = object> =
  AiClientScope<TUsageContext>;

interface ExecutedProviderCall {
  response: ProviderResponse;
  validationFeedback?: ValidationFeedback | undefined;
}

interface RunWithPolicyOptions<
  TOperation extends AiOperationEnvelope<TUsageContext>,
  TUsageContext extends object,
> {
  envelope: TOperation;
  fallbackAllowed: boolean;
  execute: (
    envelope: TOperation,
    attempt: number,
    isFallback: boolean,
  ) => Promise<AiOperationResult<TOperation>>;
}

interface BuiltProviderRequest {
  request: ProviderRequest;
  endpoint: string;
}

const TextResponseSchema = z.object({
  text: z.string(),
});

const FALLBACK_SAFE_KINDS: readonly AiErrorKind[] = [
  "provider_rate_limited",
  "provider_unavailable",
  "timeout",
];

const DEFAULT_PROVIDER_FACTORIES: Readonly<Record<string, AiProviderFactory>> =
  Object.freeze({
    openai: ({ providerConfig }) => new OpenAIDslProvider(providerConfig),
    anthropic: ({ providerConfig }) => new AnthropicProvider(providerConfig),
    gemini: ({ providerConfig }) => new OpenAIProvider(providerConfig),
  });

export function createLlmClient<
  const TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
  TResultExtensions extends object = {},
>(
  config: AiClientConfig<TRegistry, TUsageContext>,
): AiClient<TRegistry, TUsageContext, TResultExtensions> {
  return new AiClient(config);
}

export class AiClient<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
  TResultExtensions extends object = {},
> {
  private readonly providerCache = new Map<string, AiProviderInstance>();

  constructor(
    private readonly config: AiClientConfig<TRegistry, TUsageContext>,
    private readonly currentScope: Readonly<AiClientScope<TUsageContext>> = {},
  ) {}

  child(scope: AiClientScopeInput<TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions> {
    return this.scope(scope);
  }

  with(scope: AiClientScopeInput<TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions> {
    return this.scope(scope);
  }

  scope(scope: AiClientScopeInput<TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions> {
    return new AiClient(this.config, mergeScope(this.currentScope, scope));
  }

  intent<TIntent extends AiIntentName<TRegistry>>(
    intent: TIntent,
  ): AiClient<TRegistry, TUsageContext, TResultExtensions> {
    return this.scope({ intent });
  }

  model(model: AiModelReference | string): AiClient<TRegistry, TUsageContext, TResultExtensions> {
    return this.scope({ model });
  }

  callSite(callSite: string): AiClient<TRegistry, TUsageContext, TResultExtensions> {
    return this.scope({ callSite });
  }

  async object<TSchema extends z.ZodType>(
    request: AiObjectRequest<TSchema, TUsageContext>,
  ): Promise<AiObjectResult<z.infer<TSchema>, TUsageContext> & TResultExtensions> {
    const prompt = this.normalizePrompt(request);
    const jsonSchema = z.toJSONSchema(request.schema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;
    const envelope = await this.createEnvelope<AiObjectOperationEnvelope<TSchema, TUsageContext>>(
      "text-object",
      request,
      jsonSchema,
      prompt,
    );

    return this.runWithPolicy({
      envelope,
      fallbackAllowed: true,
      execute: (operationEnvelope, attempt, isFallback) =>
        this.executeObjectAttempt(operationEnvelope, attempt, isFallback),
    });
  }

  async text(
    request: AiTextRequest<TUsageContext>,
  ): Promise<AiTextResult<TUsageContext> & TResultExtensions> {
    const prompt = this.normalizePrompt(request);
    const jsonSchema = z.toJSONSchema(TextResponseSchema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;
    const envelope = await this.createEnvelope<AiTextOperationEnvelope<TUsageContext>>(
      "text",
      request,
      jsonSchema,
      prompt,
    );

    return this.runWithPolicy({
      envelope,
      fallbackAllowed: true,
      execute: (operationEnvelope, attempt, isFallback) =>
        this.executeTextAttempt(operationEnvelope, attempt, isFallback),
    });
  }

  async streamObject<TSchema extends z.ZodType>(
    request: AiStreamObjectRequest<TSchema, TUsageContext>,
  ): Promise<AiStreamObjectResult<z.infer<TSchema>, TUsageContext> & TResultExtensions> {
    const prompt = this.normalizePrompt(request);
    const jsonSchema = z.toJSONSchema(request.schema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;
    const envelope = await this.createEnvelope<
      AiStreamObjectOperationEnvelope<TSchema, TUsageContext>
    >("text-stream", request, jsonSchema, prompt);

    return this.executeStreamObject(envelope) as Promise<AiStreamObjectResult<z.infer<TSchema>, TUsageContext> & TResultExtensions>;
  }

  async embed(
    request: AiEmbedRequest<TUsageContext>,
  ): Promise<AiEmbedResult<TUsageContext> & TResultExtensions> {
    const envelope = await this.createEnvelope<AiEmbedOperationEnvelope<TUsageContext>>(
      "embedding",
      request,
    );

    return this.runWithPolicy({
      envelope,
      fallbackAllowed: false,
      execute: (operationEnvelope, attempt, isFallback) =>
        this.executeEmbedAttempt(operationEnvelope, attempt, isFallback),
    });
  }

  async imageEdit(
    request: AiImageEditRequest<TUsageContext>,
  ): Promise<AiImageEditResult<TUsageContext> & TResultExtensions> {
    const envelope = await this.createEnvelope<AiImageEditOperationEnvelope<TUsageContext>>(
      "image-edit",
      request,
    );

    const providerConfig = getProviderConfig(
      { providers: this.config.providers, defaultProvider: envelope.resolvedModel.provider, defaultMaxRetries: 0 },
      envelope.resolvedModel.provider,
    );
    const maxN = providerConfig?.maxImagesPerCall;
    const requestedN = request.n ?? 1;

    if (maxN && requestedN > maxN) {
      // Provider can't handle n>maxN natively. Loop independently so each
      // sub-call gets its own envelope, retry/fallback policy, middleware,
      // and usage recording.
      const subResults: Array<AiImageEditResult<TUsageContext> & TResultExtensions> = [];

      for (let i = 0; i < requestedN; i += maxN) {
        const subN = Math.min(maxN, requestedN - i);
        const subRequest: AiImageEditRequest<TUsageContext> = { ...request, n: subN };
        const subEnvelope = await this.createEnvelope<AiImageEditOperationEnvelope<TUsageContext>>(
          "image-edit",
          subRequest,
        );
        subResults.push(
          await this.runWithPolicy({
            envelope: subEnvelope,
            fallbackAllowed: true,
            execute: (operationEnvelope, attempt, isFallback) =>
              this.executeImageEditAttempt(operationEnvelope, attempt, isFallback),
          }),
        );
      }

      return mergeImageEditResults(subResults, this.errorContext(envelope));
    }

    return this.runWithPolicy({
      envelope,
      fallbackAllowed: true,
      execute: (operationEnvelope, attempt, isFallback) =>
        this.executeImageEditAttempt(operationEnvelope, attempt, isFallback),
    });
  }

  private async createEnvelope<TOperation extends AiOperationEnvelope<TUsageContext>>(
    operation: TOperation["operation"],
    request: TOperation["request"],
    jsonSchema?: Record<string, unknown>,
    prompt?: string,
  ): Promise<TOperation> {
    const intent = requestIntent(request) ?? this.currentScope.intent;
    const callSite = requestCallSite(request) ?? this.currentScope.callSite;
    await this.emitBeforeResolve({
      registry: this.config.registry,
      scope: this.currentScope,
      operation,
      intent,
      callSite,
    });

    const intentSpec = this.resolveIntentSpec(intent);
    this.assertIntentCanRunOperation(intent, intentSpec, operation);
    const resolvedModel = this.resolveModel(request, intentSpec);
    const retry = requestRetry(request) ?? this.currentScope.retry ?? intentSpec?.retry ?? DEFAULT_AI_RETRY_POLICY;
    const fallbackPolicy =
      requestFallbackPolicy(request) ??
      this.currentScope.fallbackPolicy ??
      intentSpec?.fallbackPolicy ??
      DEFAULT_AI_FALLBACK_POLICY;
    const usageContext = requestUsageContext(request) ?? this.currentScope.usageContext;

    const base = {
      operation,
      intent,
      callSite,
      resolvedModel,
      retry,
      fallbackPolicy,
      retryGroupId: createId(),
      usageContext,
    };

    if (operation === "text-object") {
      return {
        ...base,
        request: request as AiObjectRequest<z.ZodType, TUsageContext>,
        jsonSchema: requireJsonSchema(jsonSchema),
        prompt: requirePrompt(prompt),
      } as TOperation;
    }

    if (operation === "text") {
      return {
        ...base,
        request: request as AiTextRequest<TUsageContext>,
        jsonSchema: requireJsonSchema(jsonSchema),
        prompt: requirePrompt(prompt),
      } as TOperation;
    }

    if (operation === "text-stream") {
      return {
        ...base,
        request: request as AiStreamObjectRequest<z.ZodType, TUsageContext>,
        jsonSchema: requireJsonSchema(jsonSchema),
        prompt: requirePrompt(prompt),
      } as TOperation;
    }

    if (operation === "image-edit") {
      return {
        ...base,
        request: request as AiImageEditRequest<TUsageContext>,
      } as TOperation;
    }

    return {
      ...base,
      request: request as AiEmbedRequest<TUsageContext>,
    } as TOperation;
  }

  private async runWithPolicy<TOperation extends AiOperationEnvelope<TUsageContext>>(
    options: RunWithPolicyOptions<TOperation, TUsageContext>,
  ): Promise<AiOperationResult<TOperation> & TResultExtensions> {
    const attempts: Array<{
      attempt: number;
      provider: string;
      model: string;
      isFallback: boolean;
    }> = [];
    const primaryResult = await this.tryResolvedModel(options, attempts, false);
    if (primaryResult.ok) {
      return withAttempts(primaryResult.result, attempts) as AiOperationResult<TOperation> & TResultExtensions;
    }

    const fallbackResult = await this.tryFallbacks(
      options,
      attempts,
      primaryResult.error,
    );
    if (fallbackResult.ok) {
      return withAttempts(fallbackResult.result, attempts) as AiOperationResult<TOperation> & TResultExtensions;
    }

    throw fallbackResult.error;
  }

  private async tryResolvedModel<TOperation extends AiOperationEnvelope<TUsageContext>>(
    options: RunWithPolicyOptions<TOperation, TUsageContext>,
    attempts: Array<{ attempt: number; provider: string; model: string; isFallback: boolean }>,
    isFallback: boolean,
  ): Promise<
    | { ok: true; result: AiOperationResult<TOperation> }
    | { ok: false; error: AiError }
  > {
    const maxAttempts = options.envelope.retry.attempts + 1;
    let lastError: AiError | undefined;
    let validationFeedback: ValidationFeedback | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptEnvelope = withValidationFeedback(
        options.envelope,
        validationFeedback,
      );
      attempts.push({
        attempt,
        provider: attemptEnvelope.resolvedModel.provider,
        model: attemptEnvelope.resolvedModel.model,
        isFallback,
      });

      try {
        const result = await this.runAttemptWithMiddleware(
          attemptEnvelope,
          attempt,
          () => options.execute(attemptEnvelope, attempt, isFallback),
        );
        return { ok: true, result };
      } catch (error) {
        const aiError = toAiError(error, this.errorContext(attemptEnvelope));
        lastError = aiError;
        await this.emitAfterError(attemptEnvelope, attempt, aiError);
        if (!shouldRetry(aiError, options.envelope.retry, attempt)) {
          return { ok: false, error: aiError };
        }

        validationFeedback =
          aiError.kind === "schema_validation_failed"
            ? aiError.validationFeedback
            : undefined;
        await this.emitAfterRetry(attemptEnvelope, attempt, aiError);
        await sleep(options.envelope.retry.backoffMs?.[attempt - 1] ?? 0);
      }
    }

    return {
      ok: false,
      error:
        lastError ??
        new AiError({
          kind: "provider_bad_response",
          message: "AI operation failed without a captured error.",
          retryable: false,
          userVisible: false,
          ...this.errorContext(options.envelope),
        }),
    };
  }

  private async tryFallbacks<TOperation extends AiOperationEnvelope<TUsageContext>>(
    options: RunWithPolicyOptions<TOperation, TUsageContext>,
    attempts: Array<{ attempt: number; provider: string; model: string; isFallback: boolean }>,
    primaryError: AiError,
  ): Promise<
    | { ok: true; result: AiOperationResult<TOperation> }
    | { ok: false; error: AiError }
  > {
    const fallbackPolicy = options.envelope.fallbackPolicy;
    if (
      !options.fallbackAllowed ||
      fallbackPolicy.mode === "none" ||
      !canFallback(primaryError, fallbackPolicy)
    ) {
      await this.emitFallbackDecision({
        from: options.envelope.resolvedModel,
        reason: primaryError,
        willFallback: false,
      });
      return { ok: false, error: primaryError };
    }

    let lastError = primaryError;
    for (const candidate of fallbackPolicy.candidates) {
      const resolvedModel = this.resolveFallbackModel(candidate);
      await this.emitFallbackDecision({
        from: options.envelope.resolvedModel,
        to: resolvedModel,
        reason: lastError,
        willFallback: true,
      });

      const fallbackEnvelope = {
        ...options.envelope,
        resolvedModel,
      };
      const fallbackOptions = {
        ...options,
        envelope: fallbackEnvelope,
      };
      const result = await this.tryResolvedModel(fallbackOptions, attempts, true);
      if (result.ok) {
        return result;
      }
      lastError = result.error;
    }

    return { ok: false, error: lastError };
  }

  private async executeObjectAttempt<TSchema extends z.ZodType>(
    envelope: AiObjectOperationEnvelope<TSchema, TUsageContext>,
    attempt: number,
    isFallback: boolean,
  ): Promise<AiObjectResult<z.infer<TSchema>, TUsageContext>> {
    const response = await this.callStructuredProvider(
      envelope,
      envelope.request.schema,
      attempt,
      isFallback,
      envelope.validationFeedback,
    );

    if (response.validationFeedback) {
      throw new AiError({
        kind: "schema_validation_failed",
        message: `AI response failed schema validation: ${response.validationFeedback.field} - ${response.validationFeedback.error}`,
        remediation: "Retry with validation feedback or adjust the prompt/schema.",
        retryable: true,
        userVisible: false,
        validationFeedback: response.validationFeedback,
        ...this.errorContext(envelope),
      });
    }

    const parseResult = envelope.request.schema.safeParse(response.response.content);
    if (!parseResult.success) {
      throw new AiError({
        kind: "schema_validation_failed",
        message: "AI response failed schema validation after provider call.",
        remediation: "Retry with validation feedback or adjust the prompt/schema.",
        retryable: true,
        userVisible: false,
        validationFeedback: validationFeedbackFromZod(
          response.response.content,
          parseResult.error,
        ),
        ...this.errorContext(envelope),
      });
    }

    const result: AiObjectResult<z.infer<TSchema>, TUsageContext> = {
      operation: "text-object",
      output: parseResult.data,
      usage: responseUsage(response.response),
      attempts: [
        {
          attempt,
          provider: envelope.resolvedModel.provider,
          model: envelope.resolvedModel.model,
          isFallback,
        },
      ],
      provider: envelope.resolvedModel.provider,
      model: envelope.resolvedModel.model,
      intent: envelope.intent,
      callSite: envelope.callSite,
      usageContext: envelope.usageContext,
      rawResponse: response.response.rawContent,
      jsonSchema: JSON.stringify(envelope.jsonSchema, null, 2),
    };
    await this.emitAfterSuccess(envelope, attempt, result);
    return result;
  }

  private async executeTextAttempt(
    envelope: AiTextOperationEnvelope<TUsageContext>,
    attempt: number,
    isFallback: boolean,
  ): Promise<AiTextResult<TUsageContext>> {
    const response = await this.callStructuredProvider(
      envelope,
      TextResponseSchema,
      attempt,
      isFallback,
      envelope.validationFeedback,
    );

    if (response.validationFeedback) {
      throw new AiError({
        kind: "schema_validation_failed",
        message: `AI response failed text schema validation: ${response.validationFeedback.field} - ${response.validationFeedback.error}`,
        retryable: true,
        userVisible: false,
        validationFeedback: response.validationFeedback,
        ...this.errorContext(envelope),
      });
    }

    const parseResult = TextResponseSchema.safeParse(response.response.content);
    if (!parseResult.success) {
      throw new AiError({
        kind: "schema_validation_failed",
        message: "AI response failed text schema validation after provider call.",
        retryable: true,
        userVisible: false,
        validationFeedback: validationFeedbackFromZod(
          response.response.content,
          parseResult.error,
        ),
        ...this.errorContext(envelope),
      });
    }

    const result: AiTextResult<TUsageContext> = {
      operation: "text",
      output: parseResult.data.text,
      usage: responseUsage(response.response),
      attempts: [
        {
          attempt,
          provider: envelope.resolvedModel.provider,
          model: envelope.resolvedModel.model,
          isFallback,
        },
      ],
      provider: envelope.resolvedModel.provider,
      model: envelope.resolvedModel.model,
      intent: envelope.intent,
      callSite: envelope.callSite,
      usageContext: envelope.usageContext,
      rawResponse: response.response.rawContent,
      jsonSchema: JSON.stringify(envelope.jsonSchema, null, 2),
    };
    await this.emitAfterSuccess(envelope, attempt, result);
    return result;
  }

  private async executeEmbedAttempt(
    envelope: AiEmbedOperationEnvelope<TUsageContext>,
    attempt: number,
    isFallback: boolean,
  ): Promise<AiEmbedResult<TUsageContext>> {
    const provider = this.getOrCreateProvider(envelope.resolvedModel.provider);
    const inputTexts = Array.isArray(envelope.request.input)
      ? [...envelope.request.input]
      : [envelope.request.input];
    const request: AiProviderEmbeddingRequest = {
      input: inputTexts,
      model: envelope.resolvedModel.model,
      dimensions: envelope.request.dimensions,
      forceReal:
        envelope.request.forceReal ??
        this.currentScope.forceReal,
    };

    await this.emitBeforeProviderCall(envelope, attempt);
    const startedAt = Date.now();
    try {
      if (!hasEmbedding(provider)) {
        throw new AiError({
          kind: "model_capability_mismatch",
          message: `Provider '${envelope.resolvedModel.provider}' does not expose embeddings through this client.`,
          remediation: "Choose a provider factory that implements embeddings or use an embedding-capable provider.",
          retryable: false,
          userVisible: true,
          ...this.errorContext(envelope),
        });
      }
      const pool = this.config.concurrency?.forProvider(envelope.resolvedModel.provider);
      const response = pool
        ? await pool.run(() => provider.embed(request))
        : await provider.embed(request);
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "embedding",
        status: "success",
        provider: envelope.resolvedModel.provider,
        model: response.model,
        endpoint: "/embeddings",
        retryGroupId: envelope.retryGroupId,
        attempt,
        promptTokens: response.usage.promptTokens,
        totalTokens: response.usage.totalTokens,
        durationMs: Date.now() - startedAt,
        rawUsage: response.usage,
      });

      const result: AiEmbedResult<TUsageContext> = {
        operation: "embedding",
        embeddings: response.embeddings,
        usage: response.usage,
        provider: envelope.resolvedModel.provider,
        model: response.model,
        intent: envelope.intent,
        callSite: envelope.callSite,
        attempts: [
          {
            attempt,
            provider: envelope.resolvedModel.provider,
            model: envelope.resolvedModel.model,
            isFallback,
          },
        ],
        usageContext: envelope.usageContext,
      };
      await this.emitAfterSuccess(envelope, attempt, result);
      return result;
    } catch (error) {
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "embedding",
        status: "error",
        provider: envelope.resolvedModel.provider,
        model: envelope.resolvedModel.model,
        endpoint: "/embeddings",
        retryGroupId: envelope.retryGroupId,
        attempt,
        httpStatus: error instanceof LLMApiError ? error.statusCode : null,
        errorKind: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw toAiError(error, this.errorContext(envelope));
    }
  }

  private async executeImageEditAttempt(
    envelope: AiImageEditOperationEnvelope<TUsageContext>,
    attempt: number,
    isFallback: boolean,
  ): Promise<AiImageEditResult<TUsageContext>> {
    const provider = this.getOrCreateProvider(envelope.resolvedModel.provider);
    if (!hasImageEdit(provider)) {
      throw new AiError({
        kind: "model_capability_mismatch",
        message: `Provider '${envelope.resolvedModel.provider}' does not expose image editing through this client.`,
        remediation: "Choose a provider factory that implements imageEdit or use an image-capable provider.",
        retryable: false,
        userVisible: true,
        ...this.errorContext(envelope),
      });
    }

    const request: AiProviderImageEditRequest = {
      prompt: this.normalizePrompt(envelope.request),
      referenceImages: envelope.request.referenceImages,
      model: envelope.resolvedModel.model,
      size: envelope.request.size,
      n: envelope.request.n,
      quality: envelope.request.quality,
      forceReal:
        envelope.request.forceReal ??
        this.currentScope.forceReal,
    };

    await this.emitBeforeProviderCall(envelope, attempt);
    const startedAt = Date.now();
    try {
      const pool = this.config.concurrency?.forProvider(envelope.resolvedModel.provider);
      const response = pool
        ? await pool.run(() => provider.imageEdit(request))
        : await provider.imageEdit(request);
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "image_edit",
        status: "success",
        provider: envelope.resolvedModel.provider,
        model: response.model,
        endpoint: "/images/edits",
        retryGroupId: envelope.retryGroupId,
        attempt,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        durationMs: Date.now() - startedAt,
        rawUsage: response.usage.raw as object | null | undefined,
      });

      const result: AiImageEditResult<TUsageContext> = {
        operation: "image-edit",
        images: response.images,
        usage: response.usage,
        provider: envelope.resolvedModel.provider,
        model: response.model,
        intent: envelope.intent,
        callSite: envelope.callSite,
        attempts: [
          {
            attempt,
            provider: envelope.resolvedModel.provider,
            model: envelope.resolvedModel.model,
            isFallback,
          },
        ],
        usageContext: envelope.usageContext,
      };
      await this.emitAfterSuccess(envelope, attempt, result);
      return result;
    } catch (error) {
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "image_edit",
        status: "error",
        provider: envelope.resolvedModel.provider,
        model: envelope.resolvedModel.model,
        endpoint: "/images/edits",
        retryGroupId: envelope.retryGroupId,
        attempt,
        httpStatus: error instanceof LLMApiError ? error.statusCode : null,
        errorKind: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw toAiError(error, this.errorContext(envelope));
    }
  }

  private async executeStreamObject<TSchema extends z.ZodType>(
    envelope: AiStreamObjectOperationEnvelope<TSchema, TUsageContext>,
  ): Promise<AiStreamObjectResult<z.infer<TSchema>, TUsageContext>> {
    const attempt = 1;
    const result: AiStreamObjectResult<z.infer<TSchema>, TUsageContext> = {
      operation: "text-stream",
      stream: this.createProviderObjectStream(envelope, attempt),
      provider: envelope.resolvedModel.provider,
      model: envelope.resolvedModel.model,
      intent: envelope.intent,
      callSite: envelope.callSite,
      attempts: [
        {
          attempt,
          provider: envelope.resolvedModel.provider,
          model: envelope.resolvedModel.model,
          isFallback: false,
        },
      ],
      usageContext: envelope.usageContext,
    };

    return this.runAttemptWithMiddleware(envelope, attempt, async () => result);
  }

  private async *createProviderObjectStream<TSchema extends z.ZodType>(
    envelope: AiStreamObjectOperationEnvelope<TSchema, TUsageContext>,
    attempt: number,
  ): AsyncGenerator<StreamEvent<z.infer<TSchema>>, void, unknown> {
    const provider = this.getOrCreateProvider(envelope.resolvedModel.provider);
    if (!hasStreaming(provider)) {
      throw new AiError({
        kind: "model_capability_mismatch",
        message: `Provider '${envelope.resolvedModel.provider}' does not expose text streaming through this client.`,
        remediation: "Choose a provider factory that implements streamObject or use a non-streaming operation.",
        retryable: false,
        userVisible: true,
        ...this.errorContext(envelope),
      });
    }

    await this.emitBeforeProviderCall(envelope, attempt);
    const pool = this.config.concurrency?.forProvider(envelope.resolvedModel.provider);
    const releaseSlot = pool ? await pool.acquire() : null;
    const startedAt = Date.now();
    let responseId: string | null = null;
    let streamCompleted = false;
    try {
      const stream = provider.streamObject(
        {
          prompt: envelope.prompt,
          images: envelope.request.images,
          jsonSchema: envelope.jsonSchema,
          model: envelope.resolvedModel.model,
          reasoning: envelope.request.reasoning,
          timeoutMs: envelope.request.timeoutMs,
          forceReal:
            envelope.request.forceReal ??
            this.currentScope.forceReal,
          temperature: envelope.request.temperature,
        },
        envelope.request.schema,
      );

      for await (const event of stream) {
        if (event.type === "started") {
          responseId = event.responseId;
        }
        if (event.type === "error") {
          const aiError = new AiError({
            kind: "provider_bad_response",
            message: event.message,
            retryable: true,
            userVisible: false,
            ...this.errorContext(envelope),
          });
          await this.recordUsageEvent({
            usageContext: envelope.usageContext,
            operation: "llm_stream",
            status: "error",
            provider: envelope.resolvedModel.provider,
            model: envelope.resolvedModel.model,
            endpoint: "/responses",
            retryGroupId: envelope.retryGroupId,
            attempt,
            forceReal: envelope.request.forceReal ?? this.currentScope.forceReal ?? null,
            providerResponseId: responseId,
            errorKind: aiError.kind,
            errorMessage: aiError.message,
            durationMs: Date.now() - startedAt,
          });
          await this.emitAfterError(envelope, attempt, aiError);
        }
        if (event.type === "complete") {
          streamCompleted = true;
          await this.recordUsageEvent({
            usageContext: envelope.usageContext,
            operation: "llm_stream",
            status: "success",
            provider: envelope.resolvedModel.provider,
            model: envelope.resolvedModel.model,
            endpoint: "/responses",
            retryGroupId: envelope.retryGroupId,
            attempt,
            forceReal: envelope.request.forceReal ?? this.currentScope.forceReal ?? null,
            providerResponseId: responseId,
            durationMs: Date.now() - startedAt,
            promptTokens: event.usage.promptTokens,
            completionTokens: event.usage.completionTokens,
            totalTokens: event.usage.promptTokens + event.usage.completionTokens,
            cachedInputTokens: event.usage.cachedInputTokens,
            reasoningTokens: event.usage.reasoningTokens,
            rawUsage: event.usage,
          });
          await this.emitAfterSuccess(envelope, attempt, {
            operation: "text-stream",
            stream: emptyStream<z.infer<TSchema>>(),
            provider: envelope.resolvedModel.provider,
            model: envelope.resolvedModel.model,
            intent: envelope.intent,
            callSite: envelope.callSite,
            attempts: [
              {
                attempt,
                provider: envelope.resolvedModel.provider,
                model: envelope.resolvedModel.model,
                isFallback: false,
              },
            ],
            usageContext: envelope.usageContext,
          });
        }
        yield event;
      }
    } catch (error) {
      const aiError = toAiError(error, this.errorContext(envelope));
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "llm_stream",
        status: "error",
        provider: envelope.resolvedModel.provider,
        model: envelope.resolvedModel.model,
        endpoint: "/responses",
        retryGroupId: envelope.retryGroupId,
        attempt,
        forceReal: envelope.request.forceReal ?? this.currentScope.forceReal ?? null,
        providerResponseId: responseId,
        httpStatus: error instanceof LLMApiError ? error.statusCode : null,
        errorKind: aiError.kind,
        errorMessage: aiError.message,
        durationMs: Date.now() - startedAt,
      });
      await this.emitAfterError(envelope, attempt, aiError);
      throw aiError;
    } finally {
      releaseSlot?.();
      if (!streamCompleted) {
        // Streams can be intentionally abandoned by consumers; leave that as
        // an application concern rather than fabricating success.
      }
    }
  }

  private async callStructuredProvider<TSchema extends z.ZodType>(
    envelope:
      | AiObjectOperationEnvelope<TSchema, TUsageContext>
      | AiTextOperationEnvelope<TUsageContext>,
    schema: TSchema,
    attempt: number,
    _isFallback: boolean,
    validationFeedback?: ValidationFeedback | undefined,
  ): Promise<ExecutedProviderCall> {
    const provider = this.getOrCreateProvider(envelope.resolvedModel.provider);
    const providerRequest = this.buildProviderRequest(
      envelope,
      validationFeedback,
    );

    await this.emitBeforeProviderCall(envelope, attempt);
    const startedAt = Date.now();
    try {
      const pool = this.config.concurrency?.forProvider(envelope.resolvedModel.provider);
      const response = pool
        ? await pool.run(() => provider.call(providerRequest.request))
        : await provider.call(providerRequest.request);
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "llm_call",
        status: "success",
        provider: envelope.resolvedModel.provider,
        model: envelope.resolvedModel.model,
        endpoint: providerRequest.endpoint,
        retryGroupId: envelope.retryGroupId,
        attempt,
        forceReal: providerRequest.request.forceReal ?? null,
        providerResponseId: response.responseId,
        durationMs: Date.now() - startedAt,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.promptTokens + response.usage.completionTokens,
        cachedInputTokens: response.usage.cachedInputTokens,
        reasoningTokens: response.usage.reasoningTokens,
        rawUsage: response.usage,
      });

      const parseResult = schema.safeParse(response.content);
      if (parseResult.success) {
        return { response };
      }

      return {
        response,
        validationFeedback: validationFeedbackFromZod(response.content, parseResult.error),
      };
    } catch (error) {
      await this.recordUsageEvent({
        usageContext: envelope.usageContext,
        operation: "llm_call",
        status: "error",
        provider: envelope.resolvedModel.provider,
        model: envelope.resolvedModel.model,
        endpoint: providerRequest.endpoint,
        retryGroupId: envelope.retryGroupId,
        attempt,
        forceReal: providerRequest.request.forceReal ?? null,
        httpStatus: error instanceof LLMApiError ? error.statusCode : null,
        errorKind: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw toAiError(error, this.errorContext(envelope));
    }
  }

  private async runAttemptWithMiddleware<
    TOperation extends AiOperationEnvelope<TUsageContext>,
  >(
    envelope: TOperation,
    attempt: number,
    execute: () => Promise<AiOperationResult<TOperation>>,
  ): Promise<AiOperationResult<TOperation>> {
    const middleware = this.middleware();
    const context = {
      registry: this.config.registry,
      scope: this.currentScope,
      envelope,
      attempt,
      resolvedModel: envelope.resolvedModel,
    };

    const dispatch = async (index: number): Promise<AiOperationResult<TOperation>> => {
      const current = middleware[index];
      if (!current) {
        return execute();
      }
      return current(context, () => dispatch(index + 1));
    };

    return dispatch(0);
  }

  private buildProviderRequest(
    envelope:
      | AiObjectOperationEnvelope<z.ZodType, TUsageContext>
      | AiTextOperationEnvelope<TUsageContext>,
    validationFeedback?: ValidationFeedback | undefined,
  ): BuiltProviderRequest {
    const isNativeOpenAI = envelope.resolvedModel.provider === "openai";
    const reasoningEffort =
      isNativeOpenAI && "reasoningEffort" in envelope.request
        ? envelope.request.reasoningEffort
        : undefined;

    return {
      endpoint:
        envelope.resolvedModel.provider.toLowerCase() === "anthropic"
          ? "/messages"
          : "/chat/completions",
      request: {
        prompt: envelope.prompt,
        images:
          "images" in envelope.request && envelope.request.images
            ? [...envelope.request.images]
            : undefined,
        jsonSchema: envelope.jsonSchema,
        model: envelope.resolvedModel.model,
        validationFeedback,
        reasoningEffort,
        timeoutMs: envelope.request.timeoutMs,
        temperature: envelope.request.temperature,
        forceReal:
          envelope.request.forceReal ??
          this.currentScope.forceReal,
      },
    };
  }

  private normalizePrompt(request: {
    prompt?: string | undefined;
    messages?: readonly AiMessage[] | undefined;
  }): string {
    const pieces: string[] = [];
    if (request.messages) {
      for (const message of request.messages) {
        pieces.push(`### ${message.role}\n${message.content}`);
      }
    }
    if (request.prompt) {
      pieces.push(request.prompt);
    }

    if (pieces.length === 0) {
      throw new AiError({
        kind: "invalid_request",
        message: "AI operation requires a prompt or messages.",
        remediation: "Pass either prompt or messages for the operation.",
        retryable: false,
        userVisible: false,
      });
    }
    return pieces.join("\n\n");
  }

  private resolveIntentSpec(intent?: string | undefined): AiIntentSpec | undefined {
    if (!intent) return undefined;
    const spec = this.config.registry[intent];
    if (!spec) {
      throw new AiError({
        kind: "invalid_request",
        message: `Unknown AI intent '${intent}'.`,
        remediation: "Define the intent in the app-managed intent registry.",
        retryable: false,
        userVisible: false,
        intent,
      });
    }
    return spec;
  }

  private assertIntentCanRunOperation(
    intent: string | undefined,
    spec: AiIntentSpec | undefined,
    operation: AiOperationKind,
  ): void {
    if (!spec) return;
    if (spec.kind !== operation) {
      throw new AiError({
        kind: "invalid_request",
        message: `AI intent '${intent ?? "(unknown)"}' is for '${spec.kind}', not '${operation}'.`,
        remediation: "Use an intent whose operation kind matches the DSL method.",
        retryable: false,
        userVisible: false,
        intent,
      });
    }

    const operationCapabilities = capabilitiesForOperation(operation);
    const missingCapabilities =
      spec.requiredCapabilities?.filter(
        (capability) =>
          OPERATION_LEVEL_CAPABILITIES.has(capability) &&
          !operationCapabilities.includes(capability),
      ) ?? [];
    if (missingCapabilities.length > 0) {
      throw new AiError({
        kind: "model_capability_mismatch",
        message: `AI intent '${intent ?? "(unknown)"}' requires unsupported operation capabilities: ${missingCapabilities.join(", ")}.`,
        remediation: "Use a DSL operation that satisfies the intent capabilities.",
        retryable: false,
        userVisible: false,
        intent,
      });
    }
  }

  private resolveModel(
    request:
      | AiObjectRequest<z.ZodType, TUsageContext>
      | AiTextRequest<TUsageContext>
      | AiStreamObjectRequest<z.ZodType, TUsageContext>
      | AiEmbedRequest<TUsageContext>
      | AiImageEditRequest<TUsageContext>,
    intentSpec: AiIntentSpec | undefined,
  ): ResolvedAiModel {
    const callModel = request.model
      ? parseAiModelReference(request.model)
      : undefined;
    const scopedModel = this.currentScope.model
      ? parseAiModelReference(this.currentScope.model)
      : undefined;
    const intentModel = intentSpec?.defaultModel
      ? parseAiModelReference(intentSpec.defaultModel)
      : undefined;

    const modelCandidate =
      callModel?.model ??
      scopedModel?.model ??
      intentModel?.model ??
      this.config.defaultModel;
    const providerCandidate =
      request.provider ??
      callModel?.provider ??
      this.currentScope.provider ??
      scopedModel?.provider ??
      intentModel?.provider ??
      this.config.defaultProvider;

    if (!providerCandidate) {
      throw new AiError({
        kind: "provider_not_configured",
        message: "No AI provider was selected for this operation.",
        remediation: "Select a provider through the request, scope, intent model, or client default.",
        retryable: false,
        userVisible: true,
      });
    }

    const provider = providerCandidate.toLowerCase();
    if (!isProviderConfigured({ providers: this.config.providers, defaultProvider: provider, defaultMaxRetries: 0 }, provider)) {
      throw new AiError({
        kind: "provider_not_configured",
        message: `AI provider '${provider}' is not configured.`,
        remediation: "Configure provider credentials or choose a configured provider.",
        retryable: false,
        userVisible: true,
        provider,
      });
    }

    const providerDefault = this.requireProviderConfig(provider).defaultModel;
    const model = modelCandidate ?? providerDefault;
    if (!model) {
      throw new AiError({
        kind: "model_not_configured",
        message: `No model was selected for provider '${provider}'.`,
        remediation: "Set a model through the request, scope, intent, client default, or provider default.",
        retryable: false,
        userVisible: true,
        provider,
      });
    }

    return {
      provider,
      model,
      source:
        callModel?.model || request.provider
          ? "call"
          : scopedModel?.model || this.currentScope.provider
            ? "scope"
            : intentModel?.model
              ? "intent"
              : this.config.defaultModel || this.config.defaultProvider
                ? "client-default"
                : "provider-default",
    };
  }

  private resolveFallbackModel(candidate: import("./operations.js").AiModelReference): ResolvedAiModel {
    const parsed = parseAiModelReference(candidate);
    const provider = parsed.provider?.toLowerCase();
    if (!provider) {
      throw new AiError({
        kind: "provider_not_configured",
        message: `Fallback model '${parsed.model}' does not specify a provider.`,
        remediation: "Use provider/model fallback references.",
        retryable: false,
        userVisible: false,
      });
    }
    if (!(provider in this.config.providers)) {
      throw new AiError({
        kind: "provider_not_configured",
        message: `Fallback provider '${provider}' is not configured.`,
        remediation: "Configure the fallback provider or remove it from the fallback policy.",
        retryable: false,
        userVisible: true,
        provider,
      });
    }
    return {
      provider,
      model: parsed.model,
      source: "fallback",
    };
  }

  private getOrCreateProvider(providerName: string): AiProviderInstance {
    const normalizedProvider = providerName.toLowerCase();
    const cached = this.providerCache.get(normalizedProvider);
    if (cached) return cached;

    const providerConfig = this.requireProviderConfig(normalizedProvider);
    const factory =
      this.config.providerFactories?.[normalizedProvider] ??
      DEFAULT_PROVIDER_FACTORIES[normalizedProvider];
    if (!factory) {
      throw new AiError({
        kind: "provider_not_configured",
        message: `Provider '${normalizedProvider}' has no provider factory.`,
        remediation: "Pass a providerFactory for this provider.",
        retryable: false,
        userVisible: false,
        provider: normalizedProvider,
      });
    }
    const provider = factory({
      providerName: normalizedProvider,
      providerConfig,
    });
    this.providerCache.set(normalizedProvider, provider);
    return provider;
  }

  private requireProviderConfig(providerName: string): ProviderConfig {
    const config = getProviderConfig(
      {
        providers: this.config.providers,
        defaultProvider: providerName,
        defaultMaxRetries: 0,
      },
      providerName,
    );
    if (!config) {
      throw new ProviderNotConfiguredError(providerName);
    }
    return config;
  }

  private middleware(): readonly AiMiddleware<TRegistry, TUsageContext>[] {
    return this.config.plugins?.flatMap((plugin) => plugin.middleware ?? []) ?? [];
  }

  private hooks(): readonly AiHooks<TRegistry, TUsageContext>[] {
    return [
      ...(this.config.hooks ? [this.config.hooks] : []),
      ...(this.config.plugins?.flatMap((plugin) =>
        plugin.hooks ? [plugin.hooks] : [],
      ) ?? []),
    ];
  }

  private async emitBeforeResolve(
    context: Parameters<NonNullable<AiHooks<TRegistry, TUsageContext>["beforeResolve"]>>[0],
  ): Promise<void> {
    for (const hooks of this.hooks()) {
      await hooks.beforeResolve?.(context);
    }
  }

  private async emitBeforeProviderCall<TOperation extends AiOperationEnvelope<TUsageContext>>(
    envelope: TOperation,
    attempt: number,
  ): Promise<void> {
    const context = this.lifecycleContext(envelope, attempt);
    for (const hooks of this.hooks()) {
      await hooks.beforeProviderCall?.(context);
    }
  }

  private async emitAfterSuccess<TOperation extends AiOperationEnvelope<TUsageContext>>(
    envelope: TOperation,
    attempt: number,
    result: AiOperationResult<TOperation>,
  ): Promise<void> {
    const context = this.lifecycleContext(envelope, attempt);
    for (const hooks of this.hooks()) {
      await hooks.afterSuccess?.(context, result);
    }
  }

  private async emitAfterError<TOperation extends AiOperationEnvelope<TUsageContext>>(
    envelope: TOperation,
    attempt: number,
    error: AiError,
  ): Promise<void> {
    const context = this.lifecycleContext(envelope, attempt);
    for (const hooks of this.hooks()) {
      await hooks.afterError?.(context, error);
    }
  }

  private async emitAfterRetry<TOperation extends AiOperationEnvelope<TUsageContext>>(
    envelope: TOperation,
    attempt: number,
    error: AiError,
  ): Promise<void> {
    const context = this.lifecycleContext(envelope, attempt);
    for (const hooks of this.hooks()) {
      await hooks.afterRetry?.(context, error);
    }
  }

  private async emitFallbackDecision(decision: AiFallbackDecision): Promise<void> {
    for (const hooks of this.hooks()) {
      await hooks.afterFallbackDecision?.(decision);
    }
  }

  private lifecycleContext<TOperation extends AiOperationEnvelope<TUsageContext>>(
    envelope: TOperation,
    attempt: number,
  ) {
    return {
      registry: this.config.registry,
      scope: this.currentScope,
      envelope,
      attempt,
      resolvedModel: envelope.resolvedModel,
    };
  }

  private errorContext(envelope: AiOperationEnvelope<TUsageContext>): AiErrorContext {
    return {
      intent: envelope.intent,
      callSite: envelope.callSite,
      provider: envelope.resolvedModel.provider,
      model: envelope.resolvedModel.model,
      resolutionSource: envelope.resolvedModel.source,
    };
  }

  private async recordUsageEvent(event: LLMUsageEvent<TUsageContext>): Promise<void> {
    try {
      await this.config.usageRecorder?.(event);
    } catch (error) {
      throw new AiError({
        kind: "usage_record_failed",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Fix the configured AI usage recorder.",
        retryable: false,
        userVisible: false,
        originalCause: error instanceof Error ? error : undefined,
      });
    }
  }
}

function mergeScope<TUsageContext extends object>(
  parent: Readonly<AiClientScope<TUsageContext>>,
  child: AiClientScopeInput<TUsageContext>,
): Readonly<AiClientScope<TUsageContext>> {
  return {
    ...parent,
    ...child,
    usageContext:
      parent.usageContext && child.usageContext
        ? { ...parent.usageContext, ...child.usageContext }
        : child.usageContext ?? parent.usageContext,
  };
}

function requestIntent(request: { intent?: string | undefined }): string | undefined {
  return request.intent;
}

function requestCallSite(request: { callSite?: string | undefined }): string | undefined {
  return request.callSite;
}

function requestRetry(request: { retry?: AiRetryPolicy | undefined }): AiRetryPolicy | undefined {
  return request.retry;
}

function requestFallbackPolicy(request: {
  fallbackPolicy?: AiFallbackPolicy | undefined;
}): AiFallbackPolicy | undefined {
  return request.fallbackPolicy;
}

function requestUsageContext<TUsageContext extends object>(request: {
  usageContext?: TUsageContext | undefined;
}): TUsageContext | undefined {
  return request.usageContext;
}

function requireJsonSchema(
  jsonSchema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!jsonSchema) {
    throw new AiError({
      kind: "invalid_request",
      message: "Structured operation is missing a JSON schema.",
      retryable: false,
      userVisible: false,
    });
  }
  return jsonSchema;
}

function requirePrompt(prompt: string | undefined): string {
  if (!prompt) {
    throw new AiError({
      kind: "invalid_request",
      message: "Structured operation is missing a prompt.",
      retryable: false,
      userVisible: false,
    });
  }
  return prompt;
}

// Single source of truth for the capabilities each DSL operation kind
// satisfies. The Record<AiOperationKind, ...> shape forces exhaustiveness:
// adding a new operation kind to AiOperationKind without updating this map is
// a TypeScript error. Both `capabilitiesForOperation` and
// `OPERATION_LEVEL_CAPABILITIES` are derived from it.
const OPERATION_KIND_CAPABILITIES: Record<AiOperationKind, readonly AiCapability[]> = {
  "text-object": ["jsonSchema", "text"],
  text: ["jsonSchema", "text"],
  "text-stream": ["jsonSchema", "text", "streaming"],
  embedding: ["embeddings"],
  "image-edit": ["imageEdit", "references"],
};

function capabilitiesForOperation(operation: AiOperationKind): readonly AiCapability[] {
  return OPERATION_KIND_CAPABILITIES[operation];
}

// Capabilities that describe the DSL operation's contract — i.e. anything
// some operation kind exposes. Capabilities outside this set (vision,
// reasoning, longContext, ...) are model-level and validated against the
// model catalog by the app's resolver, not here.
const OPERATION_LEVEL_CAPABILITIES: ReadonlySet<AiCapability> = new Set(
  Object.values(OPERATION_KIND_CAPABILITIES).flat(),
);

function shouldRetry(
  error: AiError,
  policy: AiRetryPolicy,
  attempt: number,
): boolean {
  return attempt <= policy.attempts && policy.on.includes(error.kind);
}

function canFallback(error: AiError, policy: AiFallbackPolicy): boolean {
  return (
    policy.mode === "ordered" &&
    policy.on.includes(error.kind) &&
    FALLBACK_SAFE_KINDS.includes(error.kind)
  );
}

function responseUsage(response: ProviderResponse): TokenUsage {
  return {
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    totalTokens: response.usage.promptTokens + response.usage.completionTokens,
    cachedInputTokens: response.usage.cachedInputTokens,
    reasoningTokens: response.usage.reasoningTokens,
  };
}

function validationFeedbackFromZod(
  received: unknown,
  error: z.ZodError,
): ValidationFeedback {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return {
      field: "root",
      error: "Validation failed",
      received,
    };
  }
  return {
    field: firstIssue.path.join(".") || "root",
    error: firstIssue.message,
    received,
  };
}

function withAttempts<TOperation extends AiOperationEnvelope>(
  result: AiOperationResult<TOperation>,
  attempts: readonly {
    attempt: number;
    provider: string;
    model: string;
    isFallback: boolean;
  }[],
): AiOperationResult<TOperation> {
  return {
    ...result,
    attempts,
  };
}

/**
 * Merge N sub-call results from an n>1 image-edit loop into one combined
 * result. Concatenates `images`, `attempts`, and any array-valued extension
 * properties (e.g. `paths`, `thumbPaths` from middleware). Scalar properties
 * are taken from the last sub-result.
 */
function mergeImageEditResults<TUsageContext extends object, TExtensions extends object>(
  subResults: Array<AiImageEditResult<TUsageContext> & TExtensions>,
  errorContext: AiErrorContext,
): AiImageEditResult<TUsageContext> & TExtensions {
  if (subResults.length === 0) {
    throw new AiError({
      kind: "provider_bad_response",
      message: "Image-edit n>1 loop produced no results.",
      retryable: false,
      userVisible: true,
      ...errorContext,
    });
  }

  const last = subResults[subResults.length - 1]!;
  // Build a plain object so we can freely mutate array properties.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged: any = { ...last };
  merged.images = subResults.flatMap((r) => r.images);
  merged.attempts = subResults.flatMap((r) => r.attempts);

  // Merge any array-valued extension properties contributed by middleware
  // (e.g. paths, thumbPaths from image-persist-middleware).
  for (const key of Object.keys(last as object)) {
    if (key === "images" || key === "attempts") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sample = (last as any)[key];
    if (!Array.isArray(sample)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    merged[key] = subResults.flatMap((r) => (r as any)[key] as unknown[]);
  }

  return merged as AiImageEditResult<TUsageContext> & TExtensions;
}

function withValidationFeedback<TOperation extends AiOperationEnvelope>(
  envelope: TOperation,
  validationFeedback: ValidationFeedback | undefined,
): TOperation {
  if (
    !validationFeedback ||
    (envelope.operation !== "text-object" && envelope.operation !== "text")
  ) {
    return envelope;
  }

  return {
    ...envelope,
    validationFeedback,
  } as TOperation;
}

function hasEmbedding(provider: AiProviderInstance): provider is AiProviderInstance & AiEmbeddingProvider {
  return typeof provider.embed === "function";
}

function hasStreaming(provider: AiProviderInstance): provider is AiProviderInstance & AiStreamingProvider {
  return typeof provider.streamObject === "function";
}

function hasImageEdit(provider: AiProviderInstance): provider is AiProviderInstance & AiImageProvider {
  return typeof provider.imageEdit === "function";
}

async function* emptyStream<TOutput>(): AsyncGenerator<StreamEvent<TOutput>, void, unknown> {
  return;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
