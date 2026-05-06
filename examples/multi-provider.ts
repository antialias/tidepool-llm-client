/**
 * Multi-Provider — same schema, different models, compared.
 *
 * llm-client normalizes the interface across providers. This example sends the
 * same structured prompt to every configured provider and compares the outputs.
 * Add ANTHROPIC_API_KEY and/or GEMINI_API_KEY to your env to see more results.
 *
 * Run: OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-... npx tsx multi-provider.ts
 */

import {
  createLlmClient,
  defineIntentRegistry,
  loadConfigFromEnv,
  getConfiguredProviders,
} from "@antialias/llm-client";
import { z } from "zod";

const intents = defineIntentRegistry({
  "compare.haiku": {
    kind: "text-object",
    requiredCapabilities: ["jsonSchema"],
    defaultModel: "openai/gpt-4.1-mini",
    retry: { attempts: 1, on: ["schema_validation_failed"] },
    fallbackPolicy: { mode: "none" },
  },
} as const);

const config = loadConfigFromEnv();
const ai = createLlmClient({ registry: intents, ...config });

const HaikuResponse = z.object({
  haiku: z.string().describe("A haiku (5-7-5 syllables)"),
  interpretation: z.string().describe("What the haiku means in one sentence"),
});

const providers = getConfiguredProviders(config);
console.log(`Configured providers: ${providers.join(", ")}\n`);
console.log("Prompt: Write a haiku about debugging software.\n");
console.log("---\n");

for (const provider of providers) {
  try {
    const result = await ai.intent("compare.haiku").object({
      prompt: "Write a haiku about debugging software.",
      schema: HaikuResponse,
      provider,
    });

    console.log(`[${provider}] (model: ${result.model})`);
    console.log(`  ${result.output.haiku}`);
    console.log(`  → ${result.output.interpretation}`);
    console.log(`  (${result.usage?.totalTokens ?? "?"} tokens)\n`);
  } catch (err) {
    console.log(
      `[${provider}] error: ${err instanceof Error ? err.message : err}\n`,
    );
  }
}
