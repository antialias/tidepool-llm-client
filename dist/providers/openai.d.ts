import type { AiImageProvider, AiProviderImageEditRequest, AiProviderImageEditResponse } from "../operations.js";
import type { ProviderConfig, ProviderRequest, ProviderResponse } from "../types.js";
import { BaseProvider } from "./base.js";
/**
 * OpenAI provider implementation
 *
 * Supports both text and vision models using the chat completions API
 * with JSON mode for structured output.
 */
export declare class OpenAIProvider extends BaseProvider implements AiImageProvider {
    constructor(config: ProviderConfig);
    call(request: ProviderRequest): Promise<ProviderResponse>;
    imageEdit(request: AiProviderImageEditRequest): Promise<AiProviderImageEditResponse>;
    /**
     * Build chat messages for the request
     */
    private buildMessages;
}
//# sourceMappingURL=openai.d.ts.map