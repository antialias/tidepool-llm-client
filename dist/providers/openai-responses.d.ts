import { z } from "zod";
import type { ProviderConfig, ReasoningConfig, StreamEvent } from "../types.js";
import { Logger } from "../logger.js";
/**
 * OpenAI Responses API provider with streaming support
 *
 * Uses the new Responses API endpoint which provides:
 * - Reasoning summaries (shows the model's thinking process)
 * - Semantic streaming events
 * - Better support for reasoning models (o1, o3, o4-mini, GPT-5.2)
 */
export declare class OpenAIResponsesProvider {
    private readonly config;
    readonly name = "openai";
    private readonly logger;
    constructor(config: ProviderConfig, logger?: Logger);
    /**
     * Stream a response from the Responses API
     *
     * @param request - The request parameters
     * @param schema - Zod schema for response validation
     * @returns AsyncGenerator yielding stream events
     */
    stream<TSchema extends z.ZodType>(request: {
        prompt: string;
        images?: string[] | undefined;
        jsonSchema: Record<string, unknown>;
        model: string;
        reasoning?: ReasoningConfig | undefined;
        timeoutMs?: number | undefined;
        forceReal?: boolean | undefined;
        temperature?: number | undefined;
    }, schema: TSchema): AsyncGenerator<StreamEvent<z.infer<TSchema>>, void, unknown>;
}
//# sourceMappingURL=openai-responses.d.ts.map