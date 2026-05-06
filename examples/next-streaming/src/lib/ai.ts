import { createLlmClient, defineIntentRegistry, loadConfigFromEnv } from '@tidepool/llm-client'

const registry = defineIntentRegistry({
  'demo.sentiment': {
    kind: 'text-object',
    defaultModel: 'openai/gpt-4.1-nano',
    retry: { attempts: 1, on: ['schema_validation_failed'] },
  },
  'demo.haiku': {
    kind: 'text',
    defaultModel: 'openai/gpt-4.1-nano',
  },
  'demo.stream': {
    kind: 'text-stream',
    defaultModel: 'openai/gpt-4.1-mini',
  },
})

const config = loadConfigFromEnv()

export const ai = createLlmClient({
  registry,
  providers: config.providers,
})

export type DemoIntents = typeof registry
