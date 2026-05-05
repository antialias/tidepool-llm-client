/**
 * Default console-based logger
 */
export const defaultLogger = (level, message, data) => {
    const prefix = `[llm-client:${level}]`;
    if (data) {
        console[level === "debug" ? "log" : level](prefix, message, data);
    }
    else {
        console[level === "debug" ? "log" : level](prefix, message);
    }
};
/**
 * Error thrown when LLM validation fails after all retries
 */
export class LLMValidationError extends Error {
    constructor(feedback) {
        super(`LLM validation failed: ${feedback.field} - ${feedback.error}`);
        this.feedback = feedback;
        this.name = "LLMValidationError";
    }
}
/**
 * Error thrown when provider is not configured
 */
export class ProviderNotConfiguredError extends Error {
    constructor(provider) {
        super(`Provider '${provider}' is not configured. Check your environment variables.`);
        this.name = "ProviderNotConfiguredError";
    }
}
/**
 * Error thrown when LLM API call fails
 */
export class LLMApiError extends Error {
    constructor(provider, statusCode, message, retryAfterMs) {
        super(`${provider} API error (${statusCode}): ${message}`);
        this.provider = provider;
        this.statusCode = statusCode;
        this.retryAfterMs = retryAfterMs;
        this.name = "LLMApiError";
    }
    /** Check if this is a rate limit error */
    isRateLimited() {
        return this.statusCode === 429;
    }
    /** Check if this is a server error that may be transient */
    isServerError() {
        return this.statusCode >= 500 && this.statusCode < 600;
    }
    /** Check if this is a client error that won't be fixed by retrying */
    isClientError() {
        return (this.statusCode >= 400 && this.statusCode < 500 && this.statusCode !== 429);
    }
}
/**
 * Error thrown when LLM response is truncated due to token limits
 */
export class LLMTruncationError extends Error {
    constructor(provider, partialContent) {
        super(`${provider} response was truncated due to token limits. Partial content received.`);
        this.provider = provider;
        this.partialContent = partialContent;
        this.name = "LLMTruncationError";
    }
}
/**
 * Error thrown when LLM refuses to respond due to content filter
 */
export class LLMContentFilterError extends Error {
    constructor(provider, filterReason) {
        super(`${provider} refused to respond due to content filter${filterReason ? `: ${filterReason}` : ""}`);
        this.provider = provider;
        this.filterReason = filterReason;
        this.name = "LLMContentFilterError";
    }
}
/**
 * Error thrown when JSON parsing fails
 */
export class LLMJsonParseError extends Error {
    constructor(rawContent, parseError) {
        super(`Failed to parse LLM JSON response: ${parseError}`);
        this.rawContent = rawContent;
        this.parseError = parseError;
        this.name = "LLMJsonParseError";
    }
}
/**
 * Error thrown when LLM request times out
 */
export class LLMTimeoutError extends Error {
    constructor(provider, timeoutMs) {
        super(`${provider} request timed out after ${Math.round(timeoutMs / 1000)}s. The API server may be overloaded.`);
        this.provider = provider;
        this.timeoutMs = timeoutMs;
        this.name = "LLMTimeoutError";
    }
}
/**
 * Error thrown when network connection fails
 */
export class LLMNetworkError extends Error {
    constructor(provider, cause) {
        const causeMessage = cause?.message ?? "Unknown network error";
        super(`${provider} network error: ${causeMessage}`);
        this.provider = provider;
        this.cause = cause;
        this.name = "LLMNetworkError";
    }
}
