import type {
  AiCapability,
  AiFallbackPolicy,
  AiModelReference,
  AiOperationKind,
  AiRetryPolicy,
} from "./operations.js";

export interface AiIntentSpec {
  kind: AiOperationKind;
  requiredCapabilities?: readonly AiCapability[] | undefined;
  defaultModel?: AiModelReference | undefined;
  retry?: AiRetryPolicy | undefined;
  fallbackPolicy?: AiFallbackPolicy | undefined;
}

export type AiIntentRegistrySpec = Record<string, AiIntentSpec>;

export type AiIntentName<TRegistry extends AiIntentRegistrySpec> = Extract<
  keyof TRegistry,
  string
>;

export type DeepReadonly<T> = T extends (...args: readonly never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export type AiIntentRegistry<TSpec extends AiIntentRegistrySpec> =
  DeepReadonly<TSpec>;

export function defineIntentRegistry<const TSpec extends AiIntentRegistrySpec>(
  spec: TSpec,
): AiIntentRegistry<TSpec> {
  return deepFreeze(spec) as AiIntentRegistry<TSpec>;
}

function deepFreeze<T>(value: T): T {
  if (!isRecord(value) && !Array.isArray(value)) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    if (
      (isRecord(nestedValue) || Array.isArray(nestedValue)) &&
      !Object.isFrozen(nestedValue)
    ) {
      deepFreeze(nestedValue);
    }
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
