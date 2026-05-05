/**
 * Known provider defaults — base URLs and default models.
 */
const PROVIDER_DEFAULTS = {
    openai: {
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4.1",
    },
    anthropic: {
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: "claude-sonnet-4-6",
    },
    gemini: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        defaultModel: "gemini-2.5-flash",
    },
};
const KNOWN_PROVIDERS = ["openai", "anthropic", "gemini"];
/**
 * Parse provider config from env. Convention is simple:
 *
 *   {PROVIDER}_API_KEY      — API key (required to activate a provider)
 *   {PROVIDER}_BASE_URL     — Override base URL (optional)
 *   {PROVIDER}_MODEL        — Override default model (optional)
 *
 * Examples: OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY
 */
function parseProviderFromEnv(providerName, env) {
    const upper = providerName.toUpperCase();
    const apiKey = env[`${upper}_API_KEY`];
    if (!apiKey)
        return null;
    const defaults = PROVIDER_DEFAULTS[providerName.toLowerCase()] ?? {};
    return {
        name: providerName.toLowerCase(),
        apiKey,
        baseUrl: env[`${upper}_BASE_URL`] ??
            defaults.baseUrl ??
            `https://api.${providerName}.com/v1`,
        defaultModel: env[`${upper}_MODEL`] ?? defaults.defaultModel ?? "default",
    };
}
/**
 * Load LLM client configuration from environment variables.
 *
 * Auto-discovers providers by checking for {PROVIDER}_API_KEY env vars.
 * No LLM_ prefix needed — keeps conventions consistent with how the
 * portal already stores OPENAI_API_KEY and GEMINI_API_KEY.
 */
export function loadConfigFromEnv(env = process.env) {
    const defaultProvider = env.LLM_DEFAULT_PROVIDER?.toLowerCase() ?? "openai";
    const defaultModel = env.LLM_DEFAULT_MODEL;
    const defaultMaxRetries = parseInt(env.LLM_DEFAULT_MAX_RETRIES ?? "2", 10);
    const providers = {};
    for (const provider of KNOWN_PROVIDERS) {
        const config = parseProviderFromEnv(provider, env);
        if (config)
            providers[provider] = config;
    }
    return {
        defaultProvider,
        defaultModel,
        providers,
        defaultMaxRetries,
    };
}
export function getProviderConfig(config, providerName) {
    const name = providerName?.toLowerCase() ?? config.defaultProvider;
    return config.providers[name];
}
export function isProviderConfigured(config, providerName) {
    return providerName.toLowerCase() in config.providers;
}
export function getConfiguredProviders(config) {
    return Object.keys(config.providers);
}
