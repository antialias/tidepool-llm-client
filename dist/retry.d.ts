import type { LLMProgress, ValidationFeedback } from "./types.js";
/**
 * Options for retry execution
 */
export interface RetryOptions {
    /** Maximum number of retry attempts */
    maxRetries: number;
    /** Progress callback */
    onProgress?: ((progress: LLMProgress) => void) | undefined;
    /** Base delay for exponential backoff (ms) */
    baseDelayMs?: number | undefined;
    /** Maximum delay cap (ms) */
    maxDelayMs?: number | undefined;
}
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: unknown): boolean;
/**
 * Get the delay before retrying an error
 */
export declare function getRetryDelay(error: unknown, attempt: number, baseDelayMs: number, maxDelayMs: number): number;
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
export declare function executeWithRetry<T>(fn: (feedback?: ValidationFeedback) => Promise<T>, validate: (result: T) => ValidationFeedback | null, options: RetryOptions): Promise<{
    result: T;
    attempts: number;
}>;
/**
 * Build validation feedback message for inclusion in retry prompt
 */
export declare function buildFeedbackPrompt(feedback: ValidationFeedback): string;
//# sourceMappingURL=retry.d.ts.map