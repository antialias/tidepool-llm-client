import type { LLMProvider, ProviderConfig, ProviderRequest, ProviderResponse } from "../types.js";
/**
 * Base class for LLM providers
 *
 * Provides common functionality for building prompts and handling
 * validation feedback.
 */
export declare abstract class BaseProvider implements LLMProvider {
    protected readonly config: ProviderConfig;
    constructor(config: ProviderConfig);
    get name(): string;
    /**
     * Make an LLM call
     */
    abstract call(request: ProviderRequest): Promise<ProviderResponse>;
    /**
     * Build the prompt with schema context and validation feedback
     *
     * The prompt is structured as:
     * 1. User's original prompt
     * 2. Schema documentation (extracted from Zod .describe() annotations)
     * 3. Validation feedback (if retrying after a failed attempt)
     */
    protected buildPrompt(request: ProviderRequest): string;
    /**
     * Build human-readable documentation from the JSON schema
     *
     * Extracts descriptions from Zod's .describe() annotations and formats
     * them as clear instructions for the LLM.
     */
    protected buildSchemaDocumentation(schema: Record<string, unknown>): string;
    /**
     * Recursively extract field descriptions from JSON schema
     */
    protected extractFieldDescriptions(schema: Record<string, unknown>, path?: string): string[];
    /**
     * Parse JSON response from LLM
     */
    protected parseJsonResponse(content: string): unknown;
    /**
     * Parse Retry-After header value
     * @returns milliseconds to wait, or undefined if not present
     */
    protected parseRetryAfter(headers: Headers): number | undefined;
    protected getRequestBaseUrl(input: {
        endpoint: string;
        model: string;
        forceReal?: boolean | undefined;
    }): Promise<string>;
}
//# sourceMappingURL=base.d.ts.map