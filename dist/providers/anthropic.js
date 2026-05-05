import { LLMApiError, LLMTruncationError, LLMContentFilterError, LLMTimeoutError, LLMNetworkError, } from "../types.js";
import { BaseProvider } from "./base.js";
/** Default timeout for LLM requests (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120000;
/**
 * Anthropic provider implementation
 *
 * Uses the Messages API with tool use for structured output.
 * Falls back to JSON parsing from text if tool use is not available.
 */
export class AnthropicProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }
    async call(request) {
        const prompt = this.buildPrompt(request);
        const messages = this.buildMessages(prompt, request.images);
        // Use tool use for structured output
        const tool = {
            name: "provide_response",
            description: "Provide the response in the required JSON format. Always use this tool.",
            input_schema: request.jsonSchema,
        };
        const requestBody = {
            model: request.model,
            max_tokens: 4096,
            messages,
            tools: [tool],
            tool_choice: { type: "tool", name: "provide_response" },
        };
        if (request.temperature !== undefined) {
            requestBody.temperature = request.temperature;
        }
        // Set up timeout with AbortController
        const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const controller = new AbortController();
        let timeoutId;
        if (timeoutMs > 0) {
            timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }
        let response;
        try {
            response = await fetch(`${this.config.baseUrl}/messages`, {
                method: "POST",
                headers: {
                    "x-api-key": this.config.apiKey,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
        }
        catch (error) {
            // Clear timeout on error
            if (timeoutId)
                clearTimeout(timeoutId);
            // Handle abort (timeout)
            if (error instanceof Error && error.name === "AbortError") {
                throw new LLMTimeoutError(this.name, timeoutMs);
            }
            // Handle network errors (socket closed, connection refused, etc.)
            throw new LLMNetworkError(this.name, error instanceof Error ? error : undefined);
        }
        finally {
            // Clear timeout on success
            if (timeoutId)
                clearTimeout(timeoutId);
        }
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText;
            let errorType;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message ?? errorText;
                errorType = errorJson.error?.type;
            }
            catch {
                // Keep original text
            }
            // Parse Retry-After header for rate limits
            const retryAfterMs = this.parseRetryAfter(response.headers);
            // Check for specific Anthropic error types
            if (errorType === "invalid_request_error" &&
                errorMessage.includes("content filtering")) {
                throw new LLMContentFilterError(this.name, errorMessage);
            }
            throw new LLMApiError(this.name, response.status, errorMessage, retryAfterMs);
        }
        const data = (await response.json());
        // Check for max_tokens (truncation)
        if (data.stop_reason === "max_tokens") {
            // Try to extract partial content
            const toolUseBlock = data.content.find((block) => block.type === "tool_use");
            const textBlock = data.content.find((block) => block.type === "text");
            const partialContent = toolUseBlock?.input ?? textBlock?.text ?? null;
            throw new LLMTruncationError(this.name, partialContent);
        }
        // Find the tool use block
        const toolUseBlock = data.content.find((block) => block.type === "tool_use");
        if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
            // Fall back to text content
            const textBlock = data.content.find((block) => block.type === "text");
            if (textBlock && textBlock.text) {
                // Check if it's a refusal
                const lowerText = textBlock.text.toLowerCase();
                if (lowerText.includes("i can't") ||
                    lowerText.includes("i cannot") ||
                    lowerText.includes("i'm not able") ||
                    lowerText.includes("i am not able")) {
                    throw new LLMContentFilterError(this.name, textBlock.text);
                }
                return {
                    content: this.parseJsonResponse(textBlock.text),
                    rawContent: textBlock.text,
                    usage: {
                        promptTokens: data.usage?.input_tokens ?? 0,
                        completionTokens: data.usage?.output_tokens ?? 0,
                        cachedInputTokens: data.usage?.cache_read_input_tokens,
                    },
                    finishReason: data.stop_reason ?? "unknown",
                    responseId: data.id,
                };
            }
            throw new LLMApiError(this.name, 500, "No tool use or text content in response");
        }
        return {
            content: toolUseBlock.input,
            rawContent: JSON.stringify(toolUseBlock.input, null, 2),
            usage: {
                promptTokens: data.usage?.input_tokens ?? 0,
                completionTokens: data.usage?.output_tokens ?? 0,
                cachedInputTokens: data.usage?.cache_read_input_tokens,
            },
            finishReason: data.stop_reason ?? "unknown",
            responseId: data.id,
        };
    }
    /**
     * Build messages for the request
     */
    buildMessages(prompt, images) {
        // If no images, simple text message
        if (!images || images.length === 0) {
            return [
                {
                    role: "user",
                    content: prompt,
                },
            ];
        }
        // Vision request: combine images and text
        const content = [];
        // Add images first
        for (const imageUrl of images) {
            // Parse data URL to extract base64 and media type
            const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            const mediaType = match?.[1];
            const data = match?.[2];
            if (mediaType && data) {
                content.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: mediaType,
                        data,
                    },
                });
            }
        }
        // Add text prompt
        content.push({
            type: "text",
            text: prompt,
        });
        return [
            {
                role: "user",
                content,
            },
        ];
    }
}
