/**
 * Intent Registry — decouple call sites from model choices.
 *
 * Instead of hardcoding "gpt-4.1-mini" at every call site, define intents that
 * describe *what* you need. The registry maps intents to default models, retry
 * policies, and capability requirements. Change a model once in the registry,
 * every call site picks it up.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx intent-registry.ts
 */

import {
  createLlmClient,
  defineIntentRegistry,
  loadConfigFromEnv,
} from "@antialias/llm-client";
import { z } from "zod";

const intents = defineIntentRegistry({
  "analyze.sentiment": {
    kind: "text-object",
    requiredCapabilities: ["jsonSchema"],
    defaultModel: "openai/gpt-4.1-mini",
    retry: { attempts: 1, on: ["schema_validation_failed"] },
    fallbackPolicy: { mode: "none" },
  },
  "generate.summary": {
    kind: "text",
    requiredCapabilities: ["text"],
    defaultModel: "openai/gpt-4.1-mini",
    retry: { attempts: 0, on: [] },
    fallbackPolicy: { mode: "none" },
  },
} as const);

const ai = createLlmClient({ registry: intents, ...loadConfigFromEnv() });

const SentimentResult = z.object({
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
  confidence: z.number().min(0).max(1),
  highlights: z.array(z.string()).describe("Key phrases that drove the rating"),
});

const reviews = [
  "Absolutely love it — best purchase I've made all year.",
  "It works, I guess. Nothing special.",
  "Arrived broken. Support ghosted me. Never again.",
  "The build quality is amazing but the software is frustrating.",
];

console.log("Sentiment analysis via intent registry:\n");

for (const review of reviews) {
  const result = await ai.intent("analyze.sentiment").object({
    prompt: `Analyze the sentiment of this product review:\n\n"${review}"`,
    schema: SentimentResult,
  });

  console.log(`"${review.slice(0, 50)}..."`);
  console.log(
    `  → ${result.output.sentiment} (${(result.output.confidence * 100).toFixed(0)}%)`,
  );
  console.log(`    ${result.output.highlights.join(", ")}\n`);
}

const summary = await ai.intent("generate.summary").text({
  prompt: `Summarize the overall customer sentiment from these reviews in one sentence:\n\n${reviews.map((r) => `- "${r}"`).join("\n")}`,
});

console.log(`Overall: ${summary.output}`);
