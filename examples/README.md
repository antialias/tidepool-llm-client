# Examples

Runnable examples showing different llm-client patterns.

## Setup

```sh
# Configure the GitHub Packages registry
echo "@antialias:registry=https://npm.pkg.github.com" >> .npmrc

# Install
npm install

# Set at least one provider key
export OPENAI_API_KEY=sk-...
```

## Run

```sh
npx tsx structured-output.ts    # Extract typed data from natural language
npx tsx intent-registry.ts      # Decouple call sites from model choices
npx tsx streaming.ts            # Stream structured output with reasoning
npx tsx multi-provider.ts       # Same prompt across OpenAI/Anthropic/Gemini
npx tsx error-handling.ts       # Typed errors, retries, validation feedback
```

## What each example shows

| Example | API | Key concept |
|---------|-----|-------------|
| `structured-output` | `LLMClient` | Zod schema → validated JSON from any provider |
| `intent-registry` | `createLlmClient` + `defineIntentRegistry` | Named intents, model resolution layers |
| `streaming` | `streamObject` | Real-time structured output with reasoning |
| `multi-provider` | `createLlmClient` | Same schema sent to every configured provider |
| `error-handling` | `AiError` + `isAiError` | Typed error kinds, retry with feedback, programmatic switching |

## Provider keys

Each example uses whatever providers you have configured:

- `OPENAI_API_KEY` — OpenAI (required for most examples)
- `ANTHROPIC_API_KEY` — Anthropic (optional, used by multi-provider)
- `GEMINI_API_KEY` — Google Gemini (optional, used by multi-provider)
