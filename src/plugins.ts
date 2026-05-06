import type { AiError } from "./errors.js";
import type { AiIntentRegistrySpec } from "./intent-registry.js";
import type {
  AiFallbackPolicy,
  AiModelReference,
  AiOperationEnvelope,
  AiOperationResult,
  AiRetryPolicy,
  ResolvedAiModel,
} from "./operations.js";

export interface AiClientScope<TUsageContext extends object = object> {
  intent?: string | undefined;
  callSite?: string | undefined;
  provider?: string | undefined;
  model?: AiModelReference | string | undefined;
  usageContext?: TUsageContext | undefined;
  forceReal?: boolean | undefined;
  retry?: AiRetryPolicy | undefined;
  fallbackPolicy?: AiFallbackPolicy | undefined;
}

export interface AiLifecycleContext<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object,
  TOperation extends AiOperationEnvelope<TUsageContext>,
> {
  registry: TRegistry;
  scope: Readonly<AiClientScope<TUsageContext>>;
  envelope: TOperation;
  attempt: number;
  resolvedModel: ResolvedAiModel;
}

export interface AiResolveContext<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object,
> {
  registry: TRegistry;
  scope: Readonly<AiClientScope<TUsageContext>>;
  operation: AiOperationEnvelope<TUsageContext>["operation"];
  intent?: string | undefined;
  callSite?: string | undefined;
}

export interface AiMiddlewareContext<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object,
  TOperation extends AiOperationEnvelope<TUsageContext>,
> extends AiLifecycleContext<TRegistry, TUsageContext, TOperation> {}

export type AiMiddlewareNext<TOperation extends AiOperationEnvelope> =
  () => Promise<AiOperationResult<TOperation>>;

export type AiMiddleware<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
> = <TOperation extends AiOperationEnvelope<TUsageContext>>(
  context: AiMiddlewareContext<TRegistry, TUsageContext, TOperation>,
  next: AiMiddlewareNext<TOperation>,
) => Promise<AiOperationResult<TOperation>>;

export interface AiFallbackDecision {
  from: ResolvedAiModel;
  to?: ResolvedAiModel | undefined;
  reason: AiError;
  willFallback: boolean;
}

export interface AiHooks<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
> {
  beforeResolve?: (
    context: AiResolveContext<TRegistry, TUsageContext>,
  ) => void | Promise<void>;
  beforeProviderCall?: <TOperation extends AiOperationEnvelope<TUsageContext>>(
    context: AiLifecycleContext<TRegistry, TUsageContext, TOperation>,
  ) => void | Promise<void>;
  afterSuccess?: <TOperation extends AiOperationEnvelope<TUsageContext>>(
    context: AiLifecycleContext<TRegistry, TUsageContext, TOperation>,
    result: AiOperationResult<TOperation>,
  ) => void | Promise<void>;
  afterError?: <TOperation extends AiOperationEnvelope<TUsageContext>>(
    context: AiLifecycleContext<TRegistry, TUsageContext, TOperation>,
    error: AiError,
  ) => void | Promise<void>;
  afterRetry?: <TOperation extends AiOperationEnvelope<TUsageContext>>(
    context: AiLifecycleContext<TRegistry, TUsageContext, TOperation>,
    error: AiError,
  ) => void | Promise<void>;
  afterFallbackDecision?: (
    decision: AiFallbackDecision,
  ) => void | Promise<void>;
}

export interface AiPlugin<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
> {
  name: string;
  middleware?: readonly AiMiddleware<TRegistry, TUsageContext>[] | undefined;
  hooks?: AiHooks<TRegistry, TUsageContext> | undefined;
}

export function defineAiPlugin<
  TRegistry extends AiIntentRegistrySpec,
  TUsageContext extends object = object,
>(
  plugin: AiPlugin<TRegistry, TUsageContext>,
): AiPlugin<TRegistry, TUsageContext> {
  return plugin;
}
