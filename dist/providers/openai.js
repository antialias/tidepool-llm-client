import { LLMApiError, LLMTruncationError, LLMContentFilterError, LLMTimeoutError, LLMNetworkError, } from "../types.js";
import { BaseProvider } from "./base.js";
/** Default timeout for LLM requests (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120000;
/**
 * OpenAI provider implementation
 *
 * Supports both text and vision models using the chat completions API
 * with JSON mode for structured output.
 */
export class OpenAIProvider extends BaseProvider {
    constructor(config) {
        super(config);
    }
    async call(request) {
        const prompt = this.buildPrompt(request);
        const messages = this.buildMessages(prompt, request.images);
        const requestBody = {
            model: request.model,
            messages,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "response",
                    schema: request.jsonSchema,
                    strict: true,
                },
            },
        };
        // Add reasoning_effort for GPT-5.2+ models
        if (request.reasoningEffort) {
            requestBody.reasoning_effort = request.reasoningEffort;
        }
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
            const endpoint = "/chat/completions";
            const baseUrl = await this.getRequestBaseUrl({
                endpoint,
                model: request.model,
                forceReal: request.forceReal,
            });
            response = await fetch(`${baseUrl}${endpoint}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`,
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
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message ?? errorText;
            }
            catch {
                // Keep original text
            }
            // Parse Retry-After header for rate limits
            const retryAfterMs = this.parseRetryAfter(response.headers);
            throw new LLMApiError(this.name, response.status, errorMessage, retryAfterMs);
        }
        const data = (await response.json());
        if (!data.choices || data.choices.length === 0) {
            throw new LLMApiError(this.name, 500, "No response choices returned");
        }
        const choice = data.choices[0];
        if (!choice) {
            throw new LLMApiError(this.name, 500, "No response choices returned");
        }
        // Check for content filter refusal
        if (choice.finish_reason === "content_filter") {
            throw new LLMContentFilterError(this.name, choice.message.refusal ?? "Content was filtered by the model");
        }
        // Check for model refusal (new in GPT-4o)
        if (choice.message.refusal) {
            throw new LLMContentFilterError(this.name, choice.message.refusal);
        }
        // Check for truncation due to token limits
        if (choice.finish_reason === "length") {
            // Try to parse whatever we got
            let partialContent = null;
            if (choice.message.content) {
                try {
                    partialContent = this.parseJsonResponse(choice.message.content);
                }
                catch {
                    partialContent = choice.message.content;
                }
            }
            throw new LLMTruncationError(this.name, partialContent);
        }
        // Check for null content
        if (!choice.message.content) {
            throw new LLMApiError(this.name, 500, "Empty response content");
        }
        // Store raw content before parsing
        const rawContent = choice.message.content;
        // Parse JSON response
        const parsedContent = this.parseJsonResponse(rawContent);
        return {
            content: parsedContent,
            rawContent,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens,
                reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
            },
            finishReason: choice.finish_reason ?? "unknown",
            responseId: data.id,
        };
    }
    async imageEdit(request) {
        const endpoint = "/chat/completions";
        const baseUrl = await this.getRequestBaseUrl({
            endpoint,
            model: request.model,
            forceReal: request.forceReal,
        });
        const content = [];
        for (const ref of request.referenceImages) {
            content.push({
                type: "image_url",
                image_url: { url: ref },
            });
        }
        content.push({
            type: "text",
            text: `Using the reference images above for visual consistency (character appearance, art style, color palette), generate an illustration of the following scene:\n\n${request.prompt}`,
        });
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: request.model,
                messages: [{ role: "user", content }],
                modalities: ["text", "image"],
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error?.message ?? errorText;
            }
            catch {
                // Keep original text
            }
            throw new LLMApiError(this.name, response.status, errorMessage);
        }
        const data = (await response.json());
        const choice = data.choices?.[0];
        if (!choice) {
            throw new LLMApiError(this.name, 500, "No response choices returned");
        }
        const images = [];
        const msgContent = choice.message.content;
        if (Array.isArray(msgContent)) {
            for (const part of msgContent) {
                if (part.type === "image_url" && part.image_url?.url) {
                    images.push(part.image_url.url);
                }
            }
        }
        const raw = data.usage;
        return {
            images,
            usage: {
                promptTokens: raw?.prompt_tokens,
                completionTokens: raw?.completion_tokens,
                totalTokens: raw?.total_tokens,
                raw,
            },
            model: request.model,
            responseId: data.id,
        };
    }
    /**
     * Build chat messages for the request
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
            content.push({
                type: "image_url",
                image_url: {
                    url: imageUrl,
                    detail: "high",
                },
            });
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
