import { LLMApiError, LLMTimeoutError, LLMNetworkError } from "../types.js";
import { Logger } from "../logger.js";
/** Default idle timeout for streaming requests (2 minutes without data = abort) */
const DEFAULT_IDLE_TIMEOUT_MS = 120000;
/** Default total timeout for streaming requests (15 minutes max total time) */
const DEFAULT_TOTAL_TIMEOUT_MS = 900000;
/**
 * OpenAI Responses API provider with streaming support
 *
 * Uses the new Responses API endpoint which provides:
 * - Reasoning summaries (shows the model's thinking process)
 * - Semantic streaming events
 * - Better support for reasoning models (o1, o3, o4-mini, GPT-5.2)
 */
export class OpenAIResponsesProvider {
    constructor(config, logger) {
        this.config = config;
        this.name = "openai";
        // Use provided logger or create a disabled one
        this.logger = logger ?? new Logger({ enabled: false });
    }
    /**
     * Stream a response from the Responses API
     *
     * @param request - The request parameters
     * @param schema - Zod schema for response validation
     * @returns AsyncGenerator yielding stream events
     */
    async *stream(request, schema) {
        // Use the provided timeout as the idle timeout (time without receiving data)
        // This is smarter for streaming: we only abort if no data flows for this duration
        const idleTimeoutMs = request.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        const totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS;
        // Build the content array for the message
        const content = [];
        // Add images first (for vision)
        if (request.images && request.images.length > 0) {
            for (const imageDataUrl of request.images) {
                content.push({
                    type: "input_image",
                    image_url: imageDataUrl,
                });
            }
        }
        // Add the text prompt
        content.push({
            type: "input_text",
            text: request.prompt,
        });
        // Wrap content in a message - Responses API requires this structure for vision
        const input = [
            {
                role: "user",
                content,
            },
        ];
        // Build request body
        const requestBody = {
            model: request.model,
            input,
            stream: true,
            text: {
                format: {
                    type: "json_schema",
                    name: "response",
                    schema: request.jsonSchema,
                    strict: true,
                },
            },
        };
        // Add reasoning configuration if provided
        if (request.reasoning) {
            requestBody.reasoning = {
                effort: request.reasoning.effort,
                summary: request.reasoning.summary ?? "auto",
            };
        }
        if (request.temperature !== undefined) {
            requestBody.temperature = request.temperature;
        }
        // Set up idle timeout (resets on each chunk) and total timeout (absolute limit)
        const controller = new AbortController();
        let idleTimeoutId;
        let totalTimeoutId;
        let idleTimedOut = false;
        const resetIdleTimeout = () => {
            if (idleTimeoutId)
                clearTimeout(idleTimeoutId);
            if (idleTimeoutMs > 0) {
                idleTimeoutId = setTimeout(() => {
                    idleTimedOut = true;
                    controller.abort();
                }, idleTimeoutMs);
            }
        };
        const clearAllTimeouts = () => {
            if (idleTimeoutId)
                clearTimeout(idleTimeoutId);
            if (totalTimeoutId)
                clearTimeout(totalTimeoutId);
        };
        // Set up initial idle timeout
        resetIdleTimeout();
        // Set up total timeout (absolute limit)
        if (totalTimeoutMs > 0) {
            totalTimeoutId = setTimeout(() => {
                controller.abort();
            }, totalTimeoutMs);
        }
        let response;
        try {
            const endpoint = "/responses";
            const override = !request.forceReal
                ? await this.config.baseUrlOverride?.({
                    provider: this.name,
                    endpoint,
                    model: request.model,
                    forceReal: request.forceReal,
                })
                : undefined;
            const baseUrl = override ?? this.config.baseUrl;
            const fetchUrl = `${baseUrl}${endpoint}`;
            const bodyJson = JSON.stringify(requestBody);
            this.logger.debug("Making POST request", {
                url: fetchUrl,
                bodySize: bodyJson.length,
                model: request.model,
                reasoning: request.reasoning,
            });
            const fetchStartTime = Date.now();
            response = await fetch(fetchUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: bodyJson,
                signal: controller.signal,
            });
            this.logger.debug("Fetch completed", {
                durationMs: Date.now() - fetchStartTime,
                status: response.status,
            });
        }
        catch (error) {
            clearAllTimeouts();
            this.logger.error("Fetch error", {
                error: error instanceof Error ? error.message : String(error),
            });
            if (error instanceof Error && error.name === "AbortError") {
                const timeoutValue = idleTimedOut ? idleTimeoutMs : totalTimeoutMs;
                this.logger.error("Request aborted due to timeout", {
                    timeoutMs: timeoutValue,
                });
                throw new LLMTimeoutError(this.name, timeoutValue);
            }
            throw new LLMNetworkError(this.name, error instanceof Error ? error : undefined);
        }
        if (!response.ok) {
            clearAllTimeouts();
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
        // Process the SSE stream
        this.logger.debug("Starting to read SSE stream");
        const reader = response.body?.getReader();
        if (!reader) {
            clearAllTimeouts();
            throw new LLMApiError(this.name, 500, "No response body");
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulatedOutput = "";
        let finalResponse = null;
        let chunkCount = 0;
        let eventCount = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                chunkCount++;
                if (chunkCount <= 3 || chunkCount % 100 === 0) {
                    this.logger.debug("Chunk received", {
                        chunkNum: chunkCount,
                        size: value?.length ?? 0,
                        done,
                    });
                }
                if (done)
                    break;
                // Reset idle timeout on each received chunk - stream is still active
                resetIdleTimeout();
                buffer += decoder.decode(value, { stream: true });
                // Process complete SSE events
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? ""; // Keep incomplete line in buffer
                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6).trim();
                        if (data === "[DONE]") {
                            continue;
                        }
                        try {
                            const event = JSON.parse(data);
                            eventCount++;
                            // Handle different event types
                            switch (event.type) {
                                case "response.created":
                                    this.logger.info("Stream started", {
                                        responseId: event.response.id,
                                    });
                                    yield {
                                        type: "started",
                                        responseId: event.response.id,
                                    };
                                    break;
                                case "response.reasoning_summary_text.delta":
                                    yield {
                                        type: "reasoning",
                                        text: event.delta,
                                        summaryIndex: event.summary_index,
                                        isDelta: true,
                                    };
                                    break;
                                case "response.reasoning_summary_text.done":
                                    this.logger.debug("Reasoning summary complete", {
                                        summaryIndex: event.summary_index,
                                        textLength: event.text.length,
                                    });
                                    yield {
                                        type: "reasoning",
                                        text: event.text,
                                        summaryIndex: event.summary_index,
                                        isDelta: false,
                                    };
                                    break;
                                case "response.output_text.delta":
                                    accumulatedOutput += event.delta;
                                    yield {
                                        type: "output_delta",
                                        text: event.delta,
                                        outputIndex: event.output_index,
                                    };
                                    break;
                                case "response.completed":
                                    this.logger.info("Stream completed", {
                                        outputLength: accumulatedOutput.length,
                                        usage: finalResponse?.type === "response.completed"
                                            ? finalResponse.response.usage
                                            : undefined,
                                    });
                                    finalResponse = event;
                                    break;
                                case "response.failed":
                                    this.logger.error("Stream failed", {
                                        message: event.error.message,
                                        code: event.error.code,
                                    });
                                    yield {
                                        type: "error",
                                        message: event.error.message,
                                        code: event.error.code,
                                    };
                                    break;
                                case "error":
                                    this.logger.error("Stream error", {
                                        message: event.error.message,
                                        code: event.error.code ?? event.error.type,
                                    });
                                    yield {
                                        type: "error",
                                        message: event.error.message,
                                        code: event.error.code ?? event.error.type,
                                    };
                                    break;
                            }
                        }
                        catch {
                            // Ignore malformed JSON
                        }
                    }
                }
            }
            // Clear timeouts on successful completion
            clearAllTimeouts();
            this.logger.debug("Stream reading finished", {
                totalChunks: chunkCount,
                totalEvents: eventCount,
                hasFinalResponse: !!finalResponse,
            });
            // Extract and validate the final output
            if (finalResponse && finalResponse.type === "response.completed") {
                const output = finalResponse.response.output;
                let outputText = accumulatedOutput;
                // If we didn't accumulate output, try to extract from final response
                if (!outputText && output) {
                    for (const item of output) {
                        if (item.type === "message" && item.content) {
                            for (const content of item.content) {
                                if (content.type === "output_text" && content.text) {
                                    outputText = content.text;
                                    break;
                                }
                            }
                        }
                    }
                }
                // Parse and validate the output
                try {
                    const parsed = JSON.parse(outputText);
                    const validated = schema.parse(parsed);
                    yield {
                        type: "complete",
                        data: validated,
                        usage: {
                            promptTokens: finalResponse.response.usage?.input_tokens ?? 0,
                            completionTokens: finalResponse.response.usage?.output_tokens ?? 0,
                            cachedInputTokens: finalResponse.response.usage?.input_tokens_details?.cached_tokens,
                            reasoningTokens: finalResponse.response.usage?.reasoning_tokens ??
                                finalResponse.response.usage?.output_tokens_details?.reasoning_tokens,
                        },
                        rawResponse: outputText,
                    };
                }
                catch (error) {
                    yield {
                        type: "error",
                        message: `Failed to parse/validate response: ${error instanceof Error ? error.message : "Unknown error"}`,
                    };
                }
            }
        }
        finally {
            clearAllTimeouts();
            reader.releaseLock();
        }
    }
}
