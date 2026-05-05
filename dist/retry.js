import { LLMValidationError, LLMApiError, LLMTruncationError, LLMContentFilterError, LLMJsonParseError, LLMTimeoutError, LLMNetworkError, } from "./types.js";
/**
 * Check if an error is retryable
 */
export function isRetryableError(error) {
    // Content filter errors are never retryable - the model refused
    if (error instanceof LLMContentFilterError) {
        return false;
    }
    // Truncation errors might be retryable with a shorter prompt, but not automatically
    if (error instanceof LLMTruncationError) {
        return false;
    }
    // Validation errors are retryable - we feed back the error to the LLM
    if (error instanceof LLMValidationError) {
        return true;
    }
    // JSON parse errors are retryable - LLM might return valid JSON next time
    if (error instanceof LLMJsonParseError) {
        return true;
    }
    // Timeout errors are retryable - server may be temporarily overloaded
    if (error instanceof LLMTimeoutError) {
        return true;
    }
    // Network errors are retryable - connection may be temporarily unstable
    if (error instanceof LLMNetworkError) {
        return true;
    }
    // API errors: rate limits and server errors are retryable, client errors are not
    if (error instanceof LLMApiError) {
        return error.isRateLimited() || error.isServerError();
    }
    // Generic errors (network issues, etc.) are retryable
    return true;
}
/**
 * Get the delay before retrying an error
 */
export function getRetryDelay(error, attempt, baseDelayMs, maxDelayMs) {
    // If it's a rate limit with Retry-After, use that
    if (error instanceof LLMApiError && error.retryAfterMs) {
        return Math.min(error.retryAfterMs, maxDelayMs);
    }
    // Exponential backoff with jitter
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, maxDelayMs);
}
/**
 * Execute a function with retry logic and validation feedback
 *
 * On validation failure, the function is called again with the validation
 * error included, allowing the LLM to correct its response.
 *
 * Error handling:
 * - LLMValidationError: Retried with feedback in prompt
 * - LLMJsonParseError: Retried (LLM may return valid JSON)
 * - LLMApiError (429): Retried with Retry-After delay
 * - LLMApiError (5xx): Retried with exponential backoff
 * - LLMApiError (4xx): NOT retried (client error)
 * - LLMContentFilterError: NOT retried (model refused)
 * - LLMTruncationError: NOT retried (need shorter prompt)
 *
 * @param fn - Function to execute, receives validation feedback on retry
 * @param validate - Validation function, returns error or null if valid
 * @param options - Retry options
 */
export async function executeWithRetry(fn, validate, options) {
    const { maxRetries, onProgress, baseDelayMs = 1000, maxDelayMs = 60000, } = options;
    const maxAttempts = maxRetries + 1;
    let lastFeedback;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Report progress
        onProgress?.({
            stage: attempt === 1 ? "calling" : "retrying",
            attempt,
            maxAttempts,
            message: attempt === 1
                ? "Calling LLM..."
                : `Retry ${attempt - 1}/${maxRetries}: fixing ${lastFeedback?.field ?? "error"}`,
            validationError: lastFeedback,
        });
        try {
            // Call the function (with feedback on retry)
            const result = await fn(lastFeedback);
            // Report validation stage
            onProgress?.({
                stage: "validating",
                attempt,
                maxAttempts,
                message: "Validating response...",
            });
            // Validate the result
            const error = validate(result);
            if (!error) {
                // Success!
                return { result, attempts: attempt };
            }
            // Validation failed
            if (attempt < maxAttempts) {
                // Store feedback for next attempt
                lastFeedback = error;
                // Backoff before retry
                const delayMs = getRetryDelay(null, attempt, baseDelayMs, maxDelayMs);
                await sleep(delayMs);
            }
            else {
                // Out of retries
                throw new LLMValidationError(error);
            }
        }
        catch (error) {
            // Re-throw validation errors from final attempt
            if (error instanceof LLMValidationError) {
                throw error;
            }
            // Check if this error is retryable
            if (!isRetryableError(error)) {
                throw error;
            }
            // Store for potential re-throw
            lastError = error;
            if (attempt < maxAttempts) {
                // Calculate delay based on error type
                const delayMs = getRetryDelay(error, attempt, baseDelayMs, maxDelayMs);
                // For JSON parse errors, convert to validation feedback for next attempt
                if (error instanceof LLMJsonParseError) {
                    lastFeedback = {
                        field: "root",
                        error: "Response was not valid JSON",
                        received: error.rawContent.substring(0, 500),
                    };
                }
                await sleep(delayMs);
            }
            else {
                throw lastError;
            }
        }
    }
    // Should never reach here
    throw lastError ?? new Error("Retry logic failed unexpectedly");
}
/**
 * Sleep for a specified duration
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Build validation feedback message for inclusion in retry prompt
 */
export function buildFeedbackPrompt(feedback) {
    let prompt = "\n\nPREVIOUS ATTEMPT HAD VALIDATION ERROR:\n";
    prompt += `Field: ${feedback.field}\n`;
    prompt += `Error: ${feedback.error}\n`;
    if (feedback.received !== undefined) {
        prompt += `Received: ${JSON.stringify(feedback.received)}\n`;
    }
    if (feedback.expected !== undefined) {
        prompt += `Expected: ${JSON.stringify(feedback.expected)}\n`;
    }
    if (feedback.validOptions && feedback.validOptions.length > 0) {
        prompt += `Valid options: ${feedback.validOptions.join(", ")}\n`;
    }
    prompt += "\nPlease correct this error and provide a valid response.";
    return prompt;
}
