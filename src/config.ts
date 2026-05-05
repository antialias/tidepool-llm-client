import type { LLMClientConfig, ProviderConfig } from "./types.js";

/**
 * Known provider defaults — base URLs and default models.
 */
const PROVIDER_DEFAULTS: Record<string, Partial<ProviderConfig>> = {
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
function parseProviderFromEnv(
  providerName: string,
  env: Record<string, string | undefined>,
): ProviderConfig | null {
  const upper = providerName.toUpperCase();
  const apiKey = env[`${upper}_API_KEY`];
  if (!apiKey) return null;

  const defaults = PROVIDER_DEFAULTS[providerName.toLowerCase()] ?? {};

  return {
    name: providerName.toLowerCase(),
    apiKey,
    baseUrl:
      env[`${upper}_BASE_URL`] ??
      defaults.baseUrl ??
      `https://api.${providerName}.com/v1`,
    defaultModel:
      env[`${upper}_MODEL`] ?? defaults.defaultModel ?? "default",
  };
}

/**
 * Load LLM client configuration from environment variables.
 *
 * Auto-discovers providers by checking for {PROVIDER}_API_KEY env vars.
 * No LLM_ prefix needed — keeps conventions consistent with how the
 * portal already stores OPENAI_API_KEY and GEMINI_API_KEY.
 */
export function loadConfigFromEnv<TUsageContext extends object = object>(
  env: Record<string, string | undefined> = process.env,
): LLMClientConfig<TUsageContext> {
  const defaultProvider = env.LLM_DEFAULT_PROVIDER?.toLowerCase() ?? "openai";
  const defaultModel = env.LLM_DEFAULT_MODEL;
  const defaultMaxRetries = parseInt(env.LLM_DEFAULT_MAX_RETRIES ?? "2", 10);

  const providers: Record<string, ProviderConfig> = {};
  for (const provider of KNOWN_PROVIDERS) {
    const config = parseProviderFromEnv(provider, env);
    if (config) providers[provider] = config;
  }

  return {
    defaultProvider,
    defaultModel,
    providers,
    defaultMaxRetries,
  };
}

export function getProviderConfig<TUsageContext extends object = object>(
  config: LLMClientConfig<TUsageContext>,
  providerName?: string,
): ProviderConfig | undefined {
  const name = providerName?.toLowerCase() ?? config.defaultProvider;
  return config.providers[name];
}

export function isProviderConfigured<TUsageContext extends object = object>(
  config: LLMClientConfig<TUsageContext>,
  providerName: string,
): boolean {
  return providerName.toLowerCase() in config.providers;
}

export function getConfiguredProviders<TUsageContext extends object = object>(
  config: LLMClientConfig<TUsageContext>,
): string[] {
  return Object.keys(config.providers);
}
