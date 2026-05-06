import { Suspense } from 'react'
import { z } from 'zod'
import { ai } from '@/lib/ai'

const HaikuSchema = z.object({
  haiku: z.string(),
  subject: z.string(),
})

async function Haiku({ topic }: { topic: string }) {
  const result = await ai.intent('demo.sentiment').object({
    schema: HaikuSchema,
    prompt: `Write a haiku about "${topic}". Return the haiku text and a one-word subject.`,
  })

  return (
    <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: 4, marginBottom: '1rem' }}>
      <pre style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', whiteSpace: 'pre-wrap', margin: 0 }}>
        {result.output.haiku}
      </pre>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: 0 }}>
        Subject: {result.output.subject} — {result.provider}/{result.model}, {result.usage.totalTokens} tokens
      </p>
    </div>
  )
}

function HaikuSkeleton() {
  return (
    <div style={{ background: '#f9fafb', padding: '1rem', borderRadius: 4, marginBottom: '1rem' }}>
      <div style={{ height: '4.5rem', background: '#e5e7eb', borderRadius: 4, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
    </div>
  )
}

export default function RscPage() {
  return (
    <main>
      <h1>RSC + Suspense</h1>
      <p>
        Each haiku is an async server component that awaits <code>.object()</code> directly.
        No API route, no client-side fetch. React streams the HTML when each Suspense
        boundary resolves.
      </p>

      <h2>Three haikus, streamed independently:</h2>

      <Suspense fallback={<HaikuSkeleton />}>
        <Haiku topic="morning coffee" />
      </Suspense>

      <Suspense fallback={<HaikuSkeleton />}>
        <Haiku topic="debugging at 3am" />
      </Suspense>

      <Suspense fallback={<HaikuSkeleton />}>
        <Haiku topic="ocean waves" />
      </Suspense>
    </main>
  )
}
