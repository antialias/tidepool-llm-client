import type { LLMClientConfig, ProviderConfig } from "./types.js";
/**
 * Load LLM client configuration from environment variables.
 *
 * Auto-discovers providers by checking for {PROVIDER}_API_KEY env vars.
 * No LLM_ prefix needed — keeps conventions consistent with how the
 * portal already stores OPENAI_API_KEY and GEMINI_API_KEY.
 */
export declare function loadConfigFromEnv<TUsageContext extends object = object>(env?: Record<string, string | undefined>): LLMClientConfig<TUsageContext>;
export declare function getProviderConfig<TUsageContext extends object = object>(config: LLMClientConfig<TUsageContext>, providerName?: string): ProviderConfig | undefined;
export declare function isProviderConfigured<TUsageContext extends object = object>(config: LLMClientConfig<TUsageContext>, providerName: string): boolean;
export declare function getConfiguredProviders<TUsageContext extends object = object>(config: LLMClientConfig<TUsageContext>): string[];
//# sourceMappingURL=config.d.ts.map