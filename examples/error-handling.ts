/**
 * Error Handling — typed errors, retries with validation feedback.
 *
 * llm-client never throws generic Error. Every failure is an AiError (from the
 * DSL) or a typed LLM*Error (from the simple client) with a .kind discriminator,
 * a human-readable .remediation, and provider/model context. Schema validation
 * failures include the specific field and value that failed, and the retry loop
 * feeds that back to the model so it can self-correct.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx error-handling.ts
 */

import {
  createLlmClient,
  defineIntentRegistry,
  loadConfigFromEnv,
  AiError,
  isAiError,
} from "@antialias/llm-client";
import { z } from "zod";

const intents = defineIntentRegistry({
  "extract.date": {
    kind: "text-object",
    requiredCapabilities: ["jsonSchema"],
    defaultModel: "openai/gpt-4.1-mini",
    retry: {
      attempts: 2,
      on: ["schema_validation_failed"],
    },
    fallbackPolicy: { mode: "none" },
  },
  "bogus.intent": {
    kind: "text-object",
    requiredCapabilities: ["jsonSchema"],
    defaultModel: "fakeprovider/fake-model",
    retry: { attempts: 0, on: [] },
    fallbackPolicy: { mode: "none" },
  },
} as const);

const ai = createLlmClient({ registry: intents, ...loadConfigFromEnv() });

// --- Example 1: Schema validation with retry feedback ---

const StrictDate = z.object({
  year: z.number().int().min(1900).max(2030),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How confident you are this is correct"),
});

console.log("Example 1: Schema validation with retry\n");

const result = await ai.intent("extract.date").object({
  prompt:
    'Extract the date from this text: "The meeting was rescheduled to the third Tuesday of next month."',
  schema: StrictDate,
});

console.log(`Extracted: ${result.output.year}-${result.output.month}-${result.output.day}`);
console.log(`Confidence: ${(result.output.confidence * 100).toFixed(0)}%`);
console.log(`Attempts: ${result.attempts.length}`);
if (result.attempts.length > 1) {
  console.log(
    "  (model self-corrected after validation feedback on earlier attempt)",
  );
}

// --- Example 2: Catching typed errors ---

console.log("\n\nExample 2: Typed error handling\n");

try {
  await ai.intent("bogus.intent").object({
    prompt: "This will fail because the provider doesn't exist.",
    schema: z.object({ text: z.string() }),
  });
} catch (err) {
  if (isAiError(err)) {
    console.log(`AiError caught:`);
    console.log(`  kind:        ${err.kind}`);
    console.log(`  message:     ${err.message}`);
    console.log(`  provider:    ${err.provider ?? "(none)"}`);
    console.log(`  model:       ${err.model ?? "(none)"}`);
    console.log(`  retryable:   ${err.retryable}`);
    console.log(`  remediation: ${err.remediation ?? "(none)"}`);
  } else {
    console.log("Unexpected non-AiError:", err);
  }
}

// --- Example 3: Programmatic error kind switching ---

console.log("\n\nExample 3: Switching on error kind\n");

try {
  await ai.intent("bogus.intent").object({
    prompt: "trigger error",
    schema: z.object({ x: z.string() }),
  });
} catch (err) {
  if (!isAiError(err)) throw err;

  switch (err.kind) {
    case "provider_not_configured":
      console.log(`→ Provider "${err.provider}" is not set up.`);
      console.log(`  Action: add ${err.provider?.toUpperCase()}_API_KEY to your env.`);
      break;
    case "schema_validation_failed":
      console.log("→ Model output didn't match the schema after all retries.");
      break;
    case "provider_rate_limited":
      console.log("→ Rate limited. Back off and retry.");
      break;
    default:
      console.log(`→ ${err.kind}: ${err.message}`);
  }
}
