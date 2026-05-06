export const DEFAULT_AI_RETRY_POLICY = {
    attempts: 0,
    on: [],
};
export const DEFAULT_AI_FALLBACK_POLICY = {
    mode: "none",
};
export function parseAiModelReference(reference) {
    if (typeof reference === "string") {
        const separator = reference.indexOf("/");
        if (separator === -1) {
            return { model: reference };
        }
        return {
            provider: reference.slice(0, separator),
            model: reference.slice(separator + 1),
        };
    }
    return {
        provider: reference.provider,
        model: reference.model,
    };
}
