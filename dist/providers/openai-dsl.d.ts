import { z } from "zod";
import { Logger } from "../logger.js";
import type { AiEmbeddingProvider, AiImageProvider, AiProviderEmbeddingRequest, AiProviderEmbeddingResponse, AiProviderImageEditRequest, AiProviderImageEditResponse, AiProviderStreamObjectRequest, AiStreamingProvider } from "../operations.js";
import type { LLMProvider, ProviderConfig, ProviderRequest, ProviderResponse, StreamEvent } from "../types.js";
export declare class OpenAIDslProvider implements LLMProvider, AiStreamingProvider, AiEmbeddingProvider, AiImageProvider {
    private readonly config;
    readonly name: string;
    private readonly chatProvider;
    private readonly responsesProvider;
    constructor(config: ProviderConfig, logger?: Logger);
    call(request: ProviderRequest): Promise<ProviderResponse>;
    streamObject<TSchema extends z.ZodType>(request: AiProviderStreamObjectRequest, schema: TSchema): AsyncGenerator<StreamEvent<z.infer<TSchema>>, void, unknown>;
    imageEdit(request: AiProviderImageEditRequest): Promise<AiProviderImageEditResponse>;
    embed(request: AiProviderEmbeddingRequest): Promise<AiProviderEmbeddingResponse>;
}
//# sourceMappingURL=openai-dsl.d.ts.map