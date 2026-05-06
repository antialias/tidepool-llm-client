/**
 * Streaming — watch structured output arrive in real time.
 *
 * Uses the Responses API to stream a structured object. You get partial
 * data as it's generated. Add `reasoning: { effort: "low", summary: "auto" }`
 * with an o-series model to also see the model's thinking process.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx streaming.ts
 */

import {
  createLlmClient,
  defineIntentRegistry,
  loadConfigFromEnv,
} from "@antialias/llm-client";
import { z } from "zod";

const intents = defineIntentRegistry({
  "generate.recipe": {
    kind: "text-stream",
    requiredCapabilities: ["jsonSchema", "streaming"],
    defaultModel: "openai/gpt-4.1-mini",
    retry: { attempts: 0, on: [] },
    fallbackPolicy: { mode: "none" },
  },
} as const);

const ai = createLlmClient({ registry: intents, ...loadConfigFromEnv() });

const Recipe = z.object({
  name: z.string(),
  servings: z.number(),
  prepMinutes: z.number(),
  cookMinutes: z.number(),
  ingredients: z.array(
    z.object({
      item: z.string(),
      amount: z.string(),
    }),
  ),
  steps: z.array(z.string()),
  tip: z.string().describe("One pro tip for this recipe"),
});

console.log("Streaming a recipe...\n");

const result = await ai.intent("generate.recipe").streamObject({
  prompt:
    "Create a recipe for a weeknight pasta dish that uses pantry staples and takes under 30 minutes.",
  schema: Recipe,
});

for await (const event of result.stream) {
  switch (event.type) {
    case "reasoning":
      process.stdout.write(`[thinking] ${event.text}\n`);
      break;
    case "output_delta":
      process.stdout.write(".");
      break;
    case "complete":
      console.log("\n");
      console.log(`${event.data.name} (${event.data.servings} servings)`);
      console.log(
        `Prep: ${event.data.prepMinutes}min | Cook: ${event.data.cookMinutes}min\n`,
      );
      console.log("Ingredients:");
      for (const ing of event.data.ingredients) {
        console.log(`  ${ing.amount} ${ing.item}`);
      }
      console.log("\nSteps:");
      event.data.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
      console.log(`\nTip: ${event.data.tip}`);
      console.log(
        `\n[${event.usage.promptTokens + event.usage.completionTokens} tokens]`,
      );
      break;
    case "error":
      console.error(`\nStream error: ${event.message}`);
      break;
  }
}
