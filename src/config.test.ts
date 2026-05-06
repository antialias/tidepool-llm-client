import { describe, expect, it } from "vitest";
import {
  getConfiguredProviders,
  getProviderConfig,
  isProviderConfigured,
  loadConfigFromEnv,
} from "./config.js";

describe("loadConfigFromEnv", () => {
  it("loads Tidepool-style provider environment variables", () => {
    const config = loadConfigFromEnv({
      LLM_DEFAULT_PROVIDER: "gemini",
      LLM_DEFAULT_MODEL: "gemini-custom",
      LLM_DEFAULT_MAX_RETRIES: "4",
      OPENAI_API_KEY: "sk-openai",
      GEMINI_API_KEY: "sk-gemini",
      GEMINI_BASE_URL: "https://example.test/gemini",
      GEMINI_MODEL: "gemini-2.5-flash-lite",
      ANTHROPIC_API_KEY: "sk-anthropic",
    });

    expect(config.defaultProvider).toBe("gemini");
    expect(config.defaultModel).toBe("gemini-custom");
    expect(config.defaultMaxRetries).toBe(4);
    expect(config.providers.openai?.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.providers.gemini?.baseUrl).toBe("https://example.test/gemini");
    expect(config.providers.gemini?.defaultModel).toBe("gemini-2.5-flash-lite");
    expect(config.providers.anthropic?.defaultModel).toBe("claude-sonnet-4-6");
  });

  it("only configures providers with API keys", () => {
    const config = loadConfigFromEnv({
      OPENAI_MODEL: "gpt-5.4",
      GEMINI_API_KEY: "sk-gemini",
    });

    expect(getConfiguredProviders(config)).toEqual(["gemini"]);
    expect(isProviderConfigured(config, "openai")).toBe(false);
    expect(isProviderConfigured(config, "gemini")).toBe(true);
    expect(getProviderConfig(config, "GEMINI")?.apiKey).toBe("sk-gemini");
  });
});
