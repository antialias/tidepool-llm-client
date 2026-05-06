import { LLMApiError, LLMContentFilterError, LLMJsonParseError, LLMNetworkError, LLMTimeoutError, LLMTruncationError, LLMValidationError, ProviderNotConfiguredError, } from "./types.js";
export class AiError extends Error {
    constructor(details) {
        super(details.message);
        this.name = "AiError";
        this.kind = details.kind;
        this.remediation = details.remediation;
        this.intent = details.intent;
        this.callSite = details.callSite;
        this.provider = details.provider;
        this.model = details.model;
        this.resolutionSource = details.resolutionSource;
        this.retryable = details.retryable ?? false;
        this.userVisible = details.userVisible ?? true;
        this.validationFeedback = details.validationFeedback;
        this.originalCause = details.originalCause;
    }
}
export function isAiError(error, kind) {
    return error instanceof AiError && (kind === undefined || error.kind === kind);
}
export function toAiError(error, context = {}) {
    if (error instanceof AiError) {
        return enrichAiError(error, context);
    }
    if (error instanceof ProviderNotConfiguredError) {
        return new AiError({
            kind: "provider_not_configured",
            message: error.message,
            remediation: "Configure provider credentials or choose a configured provider.",
            retryable: false,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMValidationError) {
        return new AiError({
            kind: "schema_validation_failed",
            message: error.message,
            remediation: "Retry with validation feedback or adjust the response schema/prompt.",
            retryable: true,
            userVisible: false,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMJsonParseError) {
        return new AiError({
            kind: "provider_bad_response",
            message: error.message,
            remediation: "Retry the same provider/model or inspect the provider response.",
            retryable: true,
            userVisible: false,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMContentFilterError) {
        return new AiError({
            kind: "provider_refused",
            message: error.message,
            remediation: "Change the request content or choose a model/policy that can handle it.",
            retryable: false,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMTruncationError) {
        return new AiError({
            kind: "context_too_large",
            message: error.message,
            remediation: "Shorten the prompt or choose a model with a larger context window.",
            retryable: false,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMTimeoutError) {
        return new AiError({
            kind: "timeout",
            message: error.message,
            remediation: "Retry the same model or investigate provider latency.",
            retryable: true,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMNetworkError) {
        return new AiError({
            kind: "provider_unavailable",
            message: error.message,
            remediation: "Retry the same model after the provider/network recovers.",
            retryable: true,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error instanceof LLMApiError) {
        return mapApiError(error, context);
    }
    if (error instanceof Error && error.name === "AbortError") {
        return new AiError({
            kind: "cancelled",
            message: error.message || "Operation was cancelled.",
            remediation: "Start the operation again if cancellation was unintended.",
            retryable: false,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    const message = error instanceof Error ? error.message : String(error);
    return new AiError({
        kind: "provider_bad_response",
        message,
        remediation: "Inspect the failing AI call and provider response.",
        retryable: false,
        userVisible: false,
        originalCause: error instanceof Error ? error : undefined,
        ...context,
    });
}
function mapApiError(error, context) {
    if (error.statusCode === 429) {
        return new AiError({
            kind: "provider_rate_limited",
            message: error.message,
            remediation: "Retry later or reduce concurrency.",
            retryable: true,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error.isServerError()) {
        return new AiError({
            kind: "provider_unavailable",
            message: error.message,
            remediation: "Retry after the provider recovers.",
            retryable: true,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    if (error.isClientError()) {
        return new AiError({
            kind: "invalid_request",
            message: error.message,
            remediation: "Fix provider/model configuration or request parameters.",
            retryable: false,
            userVisible: true,
            originalCause: error,
            ...context,
        });
    }
    return new AiError({
        kind: "provider_bad_response",
        message: error.message,
        remediation: "Inspect the provider response.",
        retryable: false,
        userVisible: false,
        originalCause: error,
        ...context,
    });
}
function enrichAiError(error, context) {
    if (error.intent === context.intent &&
        error.callSite === context.callSite &&
        error.provider === context.provider &&
        error.model === context.model &&
        error.resolutionSource === context.resolutionSource) {
        return error;
    }
    return new AiError({
        kind: error.kind,
        message: error.message,
        remediation: error.remediation,
        intent: error.intent ?? context.intent,
        callSite: error.callSite ?? context.callSite,
        provider: error.provider ?? context.provider,
        model: error.model ?? context.model,
        resolutionSource: error.resolutionSource ?? context.resolutionSource,
        retryable: error.retryable,
        userVisible: error.userVisible,
        validationFeedback: error.validationFeedback,
        originalCause: error.originalCause,
    });
}
