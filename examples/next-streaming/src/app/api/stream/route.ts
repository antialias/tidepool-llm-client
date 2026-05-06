import { z } from 'zod'
import { ai } from '@/lib/ai'
import type { StreamEvent } from '@tidepool/llm-client'

const StorySchema = z.object({
  title: z.string(),
  story: z.string(),
  mood: z.enum(['happy', 'sad', 'mysterious', 'adventurous', 'funny']),
})

export async function POST(req: Request) {
  const { topic } = await req.json() as { topic: string }

  const result = await ai.intent('demo.stream').streamObject({
    schema: StorySchema,
    prompt: `Write a very short (3-4 sentence) story about: ${topic}. Return it as structured JSON with a title, the story text, and the mood.`,
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of result.stream) {
          const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(line))
        }
      } catch (err) {
        const errorEvent: StreamEvent<unknown> = {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        }
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
