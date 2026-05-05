import type { ValidationFeedback } from "./types.js";
export type AiErrorKind = "model_not_configured" | "provider_not_configured" | "model_capability_mismatch" | "invalid_request" | "context_too_large" | "schema_validation_failed" | "provider_rate_limited" | "provider_unavailable" | "provider_refused" | "provider_bad_response" | "timeout" | "cancelled" | "budget_exceeded" | "usage_record_failed" | "billing_failed";
export type AiResolutionSource = "call" | "scope" | "user" | "sitewide" | "intent" | "client-default" | "provider-default" | "fallback";
export interface AiErrorDetails<TKind extends AiErrorKind = AiErrorKind> {
    kind: TKind;
    message: string;
    remediation?: string | undefined;
    intent?: string | undefined;
    callSite?: string | undefined;
    provider?: string | undefined;
    model?: string | undefined;
    resolutionSource?: AiResolutionSource | undefined;
    retryable?: boolean | undefined;
    userVisible?: boolean | undefined;
    validationFeedback?: ValidationFeedback | undefined;
    originalCause?: Error | undefined;
}
export interface AiErrorContext {
    intent?: string | undefined;
    callSite?: string | undefined;
    provider?: string | undefined;
    model?: string | undefined;
    resolutionSource?: AiResolutionSource | undefined;
}
export declare class AiError<TKind extends AiErrorKind = AiErrorKind> extends Error {
    readonly kind: TKind;
    readonly remediation?: string | undefined;
    readonly intent?: string | undefined;
    readonly callSite?: string | undefined;
    readonly provider?: string | undefined;
    readonly model?: string | undefined;
    readonly resolutionSource?: AiResolutionSource | undefined;
    readonly retryable: boolean;
    readonly userVisible: boolean;
    readonly validationFeedback?: ValidationFeedback | undefined;
    readonly originalCause?: Error | undefined;
    constructor(details: AiErrorDetails<TKind>);
}
export declare function isAiError(error: unknown): error is AiError;
export declare function isAiError<TKind extends AiErrorKind>(error: unknown, kind: TKind): error is AiError<TKind>;
export declare function toAiError(error: unknown, context?: AiErrorContext): AiError;
//# sourceMappingURL=errors.d.ts.map