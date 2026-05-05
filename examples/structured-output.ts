/**
 * Structured Output — extract typed data from natural language.
 *
 * The simplest llm-client pattern: pass a Zod schema, get validated data back.
 * The provider returns JSON conforming to your schema; llm-client validates it
 * and retries with feedback if the response doesn't match.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx structured-output.ts
 */

import { LLMClient } from "@antialias/llm-client";
import { z } from "zod";

const llm = new LLMClient();

const MovieRecommendation = z.object({
  title: z.string().describe("Movie title"),
  year: z.number().describe("Release year"),
  reason: z.string().describe("Why this movie is worth watching"),
  watchIf: z.string().describe("Who would enjoy this"),
  skipIf: z.string().describe("Who should skip it"),
});

const result = await llm.call({
  prompt:
    "Recommend one underrated sci-fi movie from the 1990s. Be opinionated.",
  schema: MovieRecommendation,
  provider: "openai",
});

console.log(`\n  ${result.data.title} (${result.data.year})\n`);
console.log(`Why:      ${result.data.reason}`);
console.log(`Watch if: ${result.data.watchIf}`);
console.log(`Skip if:  ${result.data.skipIf}`);
console.log(`\n[${result.usage?.totalTokens ?? "?"} tokens]`);
