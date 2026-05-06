import { z } from 'zod'
import { ai } from '@/lib/ai'
import { isAiError } from '@tidepool/llm-client'

const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
  confidence: z.number().min(0).max(1),
  keyPhrases: z.array(z.string()).min(1).max(5),
})

export async function POST(req: Request) {
  const { text } = await req.json() as { text: string }

  try {
    const result = await ai.intent('demo.sentiment').object({
      schema: SentimentSchema,
      prompt: `Analyze the sentiment of this text and extract key phrases:\n\n"${text}"`,
    })

    return Response.json({
      output: result.output,
      usage: result.usage,
      provider: result.provider,
      model: result.model,
    })
  } catch (err) {
    if (isAiError(err)) {
      return Response.json(
        { error: err.kind, message: err.message, remediation: err.remediation },
        { status: err.kind === 'provider_rate_limited' ? 429 : 500 },
      )
    }
    throw err
  }
}
