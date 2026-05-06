import { LLMApiError } from "../types.js";
import { OpenAIProvider } from "./openai.js";
import { OpenAIResponsesProvider } from "./openai-responses.js";
export class OpenAIDslProvider {
    constructor(config, logger) {
        this.config = config;
        this.name = config.name;
        this.chatProvider = new OpenAIProvider(config);
        this.responsesProvider = new OpenAIResponsesProvider(config, logger);
    }
    call(request) {
        return this.chatProvider.call(request);
    }
    streamObject(request, schema) {
        return this.responsesProvider.stream({
            prompt: request.prompt,
            images: request.images ? [...request.images] : undefined,
            jsonSchema: request.jsonSchema,
            model: request.model,
            reasoning: request.reasoning,
            timeoutMs: request.timeoutMs,
            forceReal: request.forceReal,
            temperature: request.temperature,
        }, schema);
    }
    async imageEdit(request) {
        const endpoint = "/v1/images/edits";
        const baseUrl = (!request.forceReal
            ? await this.config.baseUrlOverride?.({
                provider: this.name,
                endpoint,
                model: request.model,
                forceReal: request.forceReal,
            })
            : null) ?? this.config.baseUrl;
        const effectiveBase = baseUrl.replace(/\/v1$/, "");
        const formData = new FormData();
        formData.append("model", request.model);
        formData.append("prompt", `Using the reference images for visual consistency (character appearance, art style, color palette), generate the following scene:\n\n${request.prompt}`);
        if (request.size)
            formData.append("size", request.size);
        if (request.quality)
            formData.append("quality", request.quality);
        if (request.n)
            formData.append("n", String(request.n));
        for (let i = 0; i < request.referenceImages.length; i++) {
            const dataUrl = request.referenceImages[i];
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const blob = new Blob([binary], { type: "image/png" });
            formData.append("image[]", blob, `ref_${i}.png`);
        }
        const response = await fetch(`${effectiveBase}${endpoint}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: formData,
        });
        if (!response.ok) {
            const errorMessage = await readProviderError(response);
            throw new LLMApiError(this.name, response.status, errorMessage);
        }
        const data = (await response.json());
        const images = [];
        for (const item of data.data) {
            if (item.b64_json) {
                images.push(`data:image/png;base64,${item.b64_json}`);
            }
            else if (item.url) {
                const imgResp = await fetch(item.url);
                const imgBuf = await imgResp.arrayBuffer();
                const imgBase64 = uint8ArrayToBase64(new Uint8Array(imgBuf));
                images.push(`data:image/png;base64,${imgBase64}`);
            }
        }
        const raw = data.usage;
        return {
            images,
            usage: {
                promptTokens: raw?.input_tokens,
                completionTokens: raw?.output_tokens,
                totalTokens: raw?.total_tokens,
                imageInputTokens: raw?.input_tokens_details?.image_tokens,
                imageOutputTokens: raw?.output_tokens_details?.image_tokens ?? raw?.output_tokens,
                raw,
            },
            model: request.model,
            responseId: data.id,
        };
    }
    async embed(request) {
        const endpoint = "/embeddings";
        const baseUrl = (!request.forceReal
            ? await this.config.baseUrlOverride?.({
                provider: this.name,
                endpoint,
                model: request.model,
                forceReal: request.forceReal,
            })
            : null) ?? this.config.baseUrl;
        const requestBody = {
            model: request.model,
            input: request.input,
        };
        if (request.dimensions) {
            requestBody.dimensions = request.dimensions;
        }
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorMessage = await readProviderError(response);
            throw new LLMApiError(this.name, response.status, errorMessage);
        }
        const data = (await response.json());
        const sortedData = [...data.data].sort((a, b) => a.index - b.index);
        return {
            embeddings: sortedData.map((item) => new Float32Array(item.embedding)),
            usage: {
                promptTokens: data.usage.prompt_tokens,
                totalTokens: data.usage.total_tokens,
            },
            model: data.model,
        };
    }
}
function uint8ArrayToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
async function readProviderError(response) {
    const errorText = await response.text();
    try {
        const parsed = JSON.parse(errorText);
        return parsed.error?.message ?? errorText;
    }
    catch {
        return errorText;
    }
}
