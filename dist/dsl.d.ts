import { z } from "zod";
import type { ProviderConcurrencyRegistry } from "./concurrency.js";
import type { AiIntentName, AiIntentRegistrySpec } from "./intent-registry.js";
import type { AiClientScope, AiHooks, AiPlugin } from "./plugins.js";
import type { AiEmbedRequest, AiEmbedResult, AiEmbeddingProvider, AiImageEditRequest, AiImageEditResult, AiImageProvider, AiModelReference, AiObjectRequest, AiObjectResult, AiStreamingProvider, AiStreamObjectRequest, AiStreamObjectResult, AiTextRequest, AiTextResult } from "./operations.js";
import type { LLMProvider, LLMUsageRecorder, ProviderConfig } from "./types.js";
export interface AiProviderFactoryInput {
    providerName: string;
    providerConfig: ProviderConfig;
}
export type AiProviderInstance = LLMProvider & Partial<AiEmbeddingProvider> & Partial<AiStreamingProvider> & Partial<AiImageProvider>;
export type AiProviderFactory = (input: AiProviderFactoryInput) => AiProviderInstance;
export interface AiClientConfig<TRegistry extends AiIntentRegistrySpec, TUsageContext extends object = object> {
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
export type AiClientScopeInput<TUsageContext extends object = object> = AiClientScope<TUsageContext>;
export declare function createLlmClient<const TRegistry extends AiIntentRegistrySpec, TUsageContext extends object = object, TResultExtensions extends object = {}>(config: AiClientConfig<TRegistry, TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions>;
export declare class AiClient<TRegistry extends AiIntentRegistrySpec, TUsageContext extends object = object, TResultExtensions extends object = {}> {
    private readonly config;
    private readonly currentScope;
    private readonly providerCache;
    constructor(config: AiClientConfig<TRegistry, TUsageContext>, currentScope?: Readonly<AiClientScope<TUsageContext>>);
    child(scope: AiClientScopeInput<TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions>;
    with(scope: AiClientScopeInput<TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions>;
    scope(scope: AiClientScopeInput<TUsageContext>): AiClient<TRegistry, TUsageContext, TResultExtensions>;
    intent<TIntent extends AiIntentName<TRegistry>>(intent: TIntent): AiClient<TRegistry, TUsageContext, TResultExtensions>;
    model(model: AiModelReference | string): AiClient<TRegistry, TUsageContext, TResultExtensions>;
    callSite(callSite: string): AiClient<TRegistry, TUsageContext, TResultExtensions>;
    object<TSchema extends z.ZodType>(request: AiObjectRequest<TSchema, TUsageContext>): Promise<AiObjectResult<z.infer<TSchema>, TUsageContext> & TResultExtensions>;
    text(request: AiTextRequest<TUsageContext>): Promise<AiTextResult<TUsageContext> & TResultExtensions>;
    streamObject<TSchema extends z.ZodType>(request: AiStreamObjectRequest<TSchema, TUsageContext>): Promise<AiStreamObjectResult<z.infer<TSchema>, TUsageContext> & TResultExtensions>;
    embed(request: AiEmbedRequest<TUsageContext>): Promise<AiEmbedResult<TUsageContext> & TResultExtensions>;
    imageEdit(request: AiImageEditRequest<TUsageContext>): Promise<AiImageEditResult<TUsageContext> & TResultExtensions>;
    private createEnvelope;
    private runWithPolicy;
    private tryResolvedModel;
    private tryFallbacks;
    private executeObjectAttempt;
    private executeTextAttempt;
    private executeEmbedAttempt;
    private executeImageEditAttempt;
    private executeStreamObject;
    private createProviderObjectStream;
    private callStructuredProvider;
    private runAttemptWithMiddleware;
    private buildProviderRequest;
    private normalizePrompt;
    private resolveIntentSpec;
    private assertIntentCanRunOperation;
    private resolveModel;
    private resolveFallbackModel;
    private getOrCreateProvider;
    private requireProviderConfig;
    private middleware;
    private hooks;
    private emitBeforeResolve;
    private emitBeforeProviderCall;
    private emitAfterSuccess;
    private emitAfterError;
    private emitAfterRetry;
    private emitFallbackDecision;
    private lifecycleContext;
    private errorContext;
    private recordUsageEvent;
}
//# sourceMappingURL=dsl.d.ts.map