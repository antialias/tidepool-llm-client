import type { ProviderConfig, ProviderRequest, ProviderResponse } from "../types.js";
import { BaseProvider } from "./base.js";
/**
 * Anthropic provider implementation
 *
 * Uses the Messages API with tool use for structured output.
 * Falls back to JSON parsing from text if tool use is not available.
 */
export declare class AnthropicProvider extends BaseProvider {
    constructor(config: ProviderConfig);
    call(request: ProviderRequest): Promise<ProviderResponse>;
    /**
     * Build messages for the request
     */
    private buildMessages;
}
//# sourceMappingURL=anthropic.d.ts.map